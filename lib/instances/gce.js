'use strict';

var Q = require('q');
var request = require('request');
var spawn = require('child_process').spawn;

function GceInstance(master, configs) {
  var _this = this;

  _this.master = master;

  _this.prefix = 'francine';

  if (configs && configs.gce) {
    _this.project = configs.gce.project;
    _this.zone = configs.gce.zone;
    _this.masterMachineType = configs.gce.masterMachineType;
    _this.workerMachineType = configs.gce.workerMachineType;
    _this.isPreemptive = configs.gce.isPreemptive;
    _this.prefix = configs.gce.prefix || _this.prefix;
  }
}

GceInstance.prototype._retrieveAccessToken = function _retrieveAccessToken() {
  var _this = this;
  var d = Q.defer();

  // _this.master.log('GceInstance', 'Retrieving service account token...');
  request({
    uri: 'http://metadata.google.internal' +
      '/computeMetadata/v1/instance/service-accounts/default/token',
    headers: {
      'Metadata-Flavor': 'Google'
    },
    json: true
  }, function(error, response, body) {
    if (error) {
      _this.master.log('GceInstance', error);
      d.reject();
      return;
    }

    // _this.master.log('GceInstance', 'Retrieved service account token.');

    d.resolve({
      // jscs:disable
      'Authorization': 'Bearer ' + body['access_token'] // jshint ignore:line
      // jscs:enable
    });
  });

  return d.promise;
};

GceInstance.prototype.getInstances = function getInstances() {
  var _this = this;

  return _this._retrieveAccessToken()
  .then(function(headers) {
    var d = Q.defer();

    request({
      uri: 'https://www.googleapis.com' +
        '/compute/v1/projects/' + _this.project + '/zones/' + _this.zone +
        '/instances',
      headers: headers,
      json: true
    }, function(error, response, body) {
      if (error) {
        d.reject();
        return;
      }

      d.resolve(body);
    });

    return d.promise;
  })
  .then(function(body) {
    var d = Q.defer();
    var instances = body.items.filter(function(item) {
      return item.name.indexOf(_this.prefix + '-') === 0;
    }).map(function(item) {
      return {
        name: item.name,
        host: item.networkInterfaces[0].networkIP,
        port: 5000,
        resourcePort: 9000
      };
    });

    var masterHost;
    var workers = {};

    _this.size = 0;

    instances.map(function(instance) {
      if (instance.name === _this.prefix + '-master') {
        masterHost = instance.host;
      } else {
        workers[instance.name] = instance;
        _this.size++;
      }
    });

    d.resolve({
      master: {
        host: masterHost,
        port: _this.master.getPort()
      },
      workers: workers
    });
    return d.promise;
  });
};

GceInstance.prototype.resize = function resize(size) {
  var _this = this;
  var d = Q.defer();
  if (_this.size === size) {
    _this.master.log('GceInstance', 'The cluster already has size of ' + size);
    d.resolve();
    return;
  }
  _this.master.log('GceInstance',
                   'Resizing GCE managed instance group to ' + size + '...');
  _this._retrieveAccessToken()
  .then(function(headers) {
    request({
      method: 'POST',
      uri: 'https://www.googleapis.com/replicapool/v1beta2' +
        '/projects/' + _this.project + '/zones/' + _this.zone +
        '/instanceGroupManagers/' + _this.prefix + '-worker-group/resize',
      headers: headers,
      form: { size: size }
    }, function(error, response, body) {
      if (error) {
        _this.master.log('GceInstance', error);
        d.reject(error);
        return;
      }
      _this.master.log(
          'GceInstance',
          'Resized GCE managed instance group: ' + body);
      d.resolve();
    });
  });
  d.resolve();
  return d.promise;
};

GceInstance.prototype.destroy = function destroy(workerName) {
  var _this = this;
  var d = Q.defer();

  _this.master.log('GceInstance', 'Destroying ' + workerName + '...');

  _this._retrieveAccessToken()
  .then(function(headers) {
    request({
      method: 'DELETE',
      uri: 'https://www.googleapis.com' +
        '/compute/v1/projects/' + _this.project + '/zones/' + _this.zone +
        '/instances/' + workerName,
      headers: headers,
      json: true
    }, function(error, response, body) {
      _this.master.log(
          'GceInstance',
          'Destroyed ' + workerName + ': ' + JSON.stringify(body));
      d.resolve();
    });
  });

  return d.promise;
};

GceInstance.prototype._executeCommand =
function _executeCommand(command, force) {
  var _this = this;

  var d = Q.defer();

  _this.master.log('GceInstance', 'Start ' + command[0] + '...');

  var stdout = '';

  var spawned = spawn(command[2], command[3]);
  spawned.stdout.on('data', function(data) {
    _this.master.log('GceInstance', data);
    stdout += data;
  });
  spawned.stderr.on('data', function(data) {
    _this.master.log('GceInstance', data);
  });
  spawned.on('close', function(code) {
    if (code !== 0) {
      _this.master.log('GceInstance', 'Failed ' + command[0] + '.');
      _this.master.log('GceInstance', 'Returned with non-zero code: ' + code);
      if (force) {
        _this.master.log('GceInstance', 'Force option specified; continue');
        d.resolve(stdout);
      } else {
        d.reject();
      }
    } else {
      _this.master.log('GceInstance', 'Finished ' + command[0] + '.');
    }

    setTimeout(function() {
      d.resolve(stdout);
    }, command[1] * 1000);
  });

  return d.promise;
};

GceInstance.prototype._executeCommands =
function _executeCommands(commands, force) {
  var _this = this;

  var p = Q(); // jshint ignore:line

  commands.map(function(command) {
    p = p.then(function() {
      return _this._executeCommand(command, force);
    });
  });

  return p;
};

GceInstance.prototype._createFrancineImage = function _createFrancineImage() {
  var _this = this;

  return _this._executeCommands([
    ['creating builder instance', 30,
     'gcloud', ['compute', 'instances', 'create', _this.prefix + '-builder',
          '--quiet',
          '--project',       _this.project,
          '--zone',          _this.zone,
          '--machine-type',  _this.workerMachineType,
          '--image-project', 'ubuntu-os-cloud',
          '--image',         'ubuntu-1504-vivid-v20150422']],

    ['copying francine package', 0,
     'gcloud', ['compute', 'copy-files',
          _this.master.getPackageName(), _this.prefix + '-builder:~/',
          '--quiet',
          '--project', _this.project,
          '--zone',    _this.zone]],

    ['extracting francine package', 0,
     'gcloud', ['compute', 'ssh', _this.prefix + '-builder',
          '--command', 'tar xvf ' + _this.master.getPackageShortName(),
          '--quiet',
          '--project', _this.project,
          '--zone',    _this.zone]],

    ['executing setup script', 0,
     'gcloud', ['compute', 'ssh', _this.prefix + '-builder',
          '--command', 'sudo ./scripts/setup.sh gce',
          '--quiet',
          '--project', _this.project,
          '--zone',    _this.zone]],

    ['terminating builder instance', 0,
     'gcloud', ['compute', 'instances', 'delete', _this.prefix + '-builder',
          '--keep-disks', 'boot',
          '--quiet',
          '--project',    _this.project,
          '--zone',       _this.zone]],

    ['creating francine image', 0,
     'gcloud', ['compute', 'images', 'create',
          _this.master.getPackageRevision(),
          '--source-disk',      _this.prefix + '-builder',
          '--source-disk-zone', _this.zone,
          '--quiet',
          '--project',          _this.project]],

    ['deleting builder instance disk', 0,
     'gcloud', ['compute', 'disks', 'delete', _this.prefix + '-builder',
          '--quiet',
          '--project', _this.project,
          '--zone',    _this.zone]]
  ]);
};

GceInstance.prototype.setup = function setup(startMaster) {
  var _this = this;

  return _this._createFrancineImage()
  .then(function() {
    if (!startMaster) {
      return;
    }

    var instanceTemplateArgs = ['compute', 'instance-templates',
            'create', _this.prefix + '-worker-template',
            '--quiet',
            '--project',       _this.project,
            '--machine-type',  _this.workerMachineType,
            '--scopes',        'compute-rw',
            '--image',         _this.master.getPackageRevision(),
            '--network',       _this.prefix + '-cluster',
            '--metadata',      'mode=worker'];

    if (_this.isPreemptive === true) {
      // Must set --maintainance-policy to TERMINATE,
      // otherwise you'll get an error like this:
      //   - Invalid value for field 'properties.scheduling.preemptible':
      //     'true'.  Scheduling must have preemptible be false when
      //     OnHostMaintenance isn't TERMINATE.
      instanceTemplateArgs = instanceTemplateArgs.concat(
        ['--preemptible', '--maintenance-policy', 'TERMINATE']);
    }

    return _this._executeCommands([
      ['creating network', 0,
       'gcloud', ['compute', 'networks', 'create', _this.prefix + '-cluster',
            '--quiet',
            '--project', _this.project]],

      ['adding external firewall rule', 0,
       'gcloud', ['compute', 'firewall-rules', 'create', 'external',
            '--network',       _this.prefix + '-cluster',
            '--source-ranges', '0.0.0.0/0',
            '--allow',         'tcp:22', 'tcp:3000', 'tcp:4000',
            '--quiet',
            '--project',       _this.project]],

      ['adding internal firewall rule', 0,
       'gcloud', ['compute', 'firewall-rules', 'create', 'internal',
            '--network',       _this.prefix + '-cluster',
            '--source-ranges', '10.240.0.0/16',
            '--allow',         'tcp:5000', 'tcp:9000',
            '--quiet',
            '--project',       _this.project]],

      ['creating worker instance template', 0,
       'gcloud', instanceTemplateArgs],

      ['creating worker managed instance group', 0,
       'gcloud', ['preview', 'managed-instance-groups',
            '--zone',               _this.zone,
            'create',               _this.prefix + '-worker-group',
            '--quiet',
            '--project',            _this.project,
            '--base-instance-name', _this.prefix + '-worker',
            '--size',               '1',
            '--template',           _this.prefix + '-worker-template']],

      ['creating master instance', 0,
       'gcloud', ['compute', 'instances', 'create', _this.prefix + '-master',
            '--quiet',
            '--project',       _this.project,
            '--zone',          _this.zone,
            '--machine-type',  _this.masterMachineType,
            '--scopes',        'compute-rw',
            '--image',         _this.master.getPackageRevision(),
            '--network',       _this.prefix + '-cluster',
            '--metadata',
              'mode=master',
              'image=' + _this.master.getPackageRevision()]]
    ]);
  });
};

GceInstance.prototype.teardown = function teardown() {
  var _this = this;

  return _this._executeCommands([
    ['deleting worker instance group', 0,
     'gcloud', ['preview', 'managed-instance-groups',
          '--zone',    _this.zone,
          'delete',    _this.prefix + '-worker-group',
          '--quiet',
          '--project', _this.project]]
  ], true).then(function() {
    return _this._executeCommand(
      ['listing all instances', 0,
       'gcloud', ['compute', 'instances', 'list',
            '--quiet',
            '--project', _this.project,
            '--format',  'json']]);
  })
  .then(function(raw) {
    var instances = JSON.parse(raw).map(function(instance) {
      return instance.name;
    }).filter(function(instanceName) {
      return instanceName.indexOf(_this.prefix + '-') === 0;
    });
    if (instances.length === 0) {
      return;
    }
    return _this._executeCommands([
      ['deleting all instances', 0,
       'gcloud', ['compute', 'instances', 'delete'].concat(instances).concat(
             ['--quiet',
            '--project', _this.project,
            '--zone',    _this.zone])]
    ], true);
  })
  .then(function() {
    return _this._executeCommand(
      ['listing all images', 0,
       'gcloud', ['compute', 'images', 'list',
            '--quiet',
            '--project', _this.project,
            '--format', 'json']]);
  })
  .then(function(raw) {
    var images = JSON.parse(raw).map(function(image) {
      return image.name;
    }).filter(function(imageName) {
      return imageName.indexOf('francine') === 0;
    });
    if (images.length === 0) {
      return;
    }
    return _this._executeCommands([
      ['deleting all images', 0,
       'gcloud', ['compute', 'images', 'delete'].concat(images).concat(
             ['--quiet',
            '--project', _this.project])]
    ], true);
  })
  .then(function() {
    return _this._executeCommands([
      ['deleting worker instance template', 0,
       'gcloud', ['compute', 'instance-templates',
            'delete',    _this.prefix + '-worker-template',
            '--quiet',
            '--project', _this.project]],

      ['deleting firewall rules', 0,
       'gcloud', ['compute', 'firewall-rules', 'delete', 'external', 'internal',
            '--quiet',
            '--project', _this.project]],

      ['deleting network', 0,
       'gcloud', ['compute', 'networks', 'delete', _this.prefix + '-cluster',
            '--quiet',
            '--project', _this.project]]
    ], true);
  });
};

GceInstance.prototype.retrieveMetadata = function retrieveMetadata() {
  var _this = this;
  var d = Q.defer();

  _this.master.log('GceInstance', 'Retrieving metadata...');

  request({
    uri: 'http://metadata.google.internal' +
      '/computeMetadata/v1/instance/attributes/?recursive=true',
    headers: {
      'Metadata-Flavor': 'Google'
    },
    json: true
  }, function(error, response, body) {
    if (error) {
      _this.master.log('GceInstance', error);
      d.reject();
      return;
    }

    _this.master.log('GceInstance',
        'Metadata retrieved: ' + JSON.stringify(body));

    d.resolve(body);
  });

  return d.promise;
};

module.exports = GceInstance;

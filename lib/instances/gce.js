'use strict';

var Q = require('q');
var request = require('request');
var spawn = require('child_process').spawn;

var GceInstance = function (master) {
    var self = this;

    self.master = master;

    self.project = 'gcp-samples';
    self.zone = 'us-central1-a';
    self.masterMachineType = 'n1-standard-1';
    self.workerMachineType = 'n1-standard-1';
};

GceInstance.prototype._retrieveAccessToken = function () {
    var self = this;
    var d = Q.defer();

    self.master.log('GceInstance', 'Retrieving service account token...');
    request({
        uri: 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        headers: {
            'Metadata-Flavor': 'Google'
        },
        json: true
    }, function (error, response, body) {
        if (error) {
            self.master.log('GceInstance', error);
            d.reject();
            return;
        }

        self.master.log('GceInstance', 'Retrieved service account token.');

        d.resolve({
            'Authorization': 'Bearer ' + body['access_token'] // jshint ignore:line
        });
    });

    return d.promise;
};

GceInstance.prototype.getInstances = function () {
    var self = this;

    self.master.log('GceInstance', 'Start retrieving instances information...');

    return self._retrieveAccessToken()
    .then(function (headers) {
        var d = Q.defer();

        request({
            uri: 'https://www.googleapis.com/compute/v1/projects/' + self.project + '/zones/' + self.zone + '/instances',
            headers: headers,
            json: true
        }, function (error, response, body) {
            if (error) {
                d.reject();
                return;
            }

            self.master.log('GceInstance', 'Finished retrieving instances information.');

            d.resolve(body);
        });

        return d.promise;
    })
    .then(function (body) {
        var d = Q.defer();
        var instances = body.items.filter(function (item) {
            return item.name.indexOf('francine-') === 0;
        }).map(function (item) {
            return {
                name: item.name,
                host: item.networkInterfaces[0].networkIP,
                port: 5000,
                resourcePort: 9000
            };
        });

        var masterHost;
        var workers = {};

        instances.map(function (instance) {
            if (instance.name === 'francine-master') {
                masterHost = instance.host;
            } else {
                workers[instance.name] = instance;
            }
        });

        d.resolve({
            master: {
                host: masterHost,
                port: self.master.getPort()
            },
            workers: workers
        });
        return d.promise;
    });
};

GceInstance.prototype.spawn = function () {
    var self = this;

    var workerName = 'francine-worker' + (new Date().getTime() | 0);

    self.master.log('GceInstance', 'Spawning new worker ' + workerName + '...');

    return Q.all([self.retrieveMetadata(), self._retrieveAccessToken()])
    .spread(function (metadata, headers) {
        var d = Q.defer();
        request({
            method: 'POST',
            uri: 'https://www.googleapis.com/compute/v1/projects/' + self.project + '/zones/' + self.zone + '/instances',
            headers: headers,
            json: true,
            body: {
                name: workerName,
                machineType: 'zones/' + self.zone + '/machineTypes/' + self.workerMachineType,
                disks: [{
                    boot: true,
                    initializeParams: { sourceImage: 'projects/' + self.project + '/global/images/' + metadata.image }
                }],
                networkInterfaces: [{
                    network: 'projects/' + self.project + '/global/networks/francine-cluster',
                    accessConfigs: [{ name: 'External NAT', type: 'ONE_TO_ONE_NAT' }]
                }],
                metadata: {items: [{key: 'mode', value: 'worker' }]},
            }
        }, function (error, response, body) {
            self.master.log('GceInstance', 'Spawned ' + workerName + ': ' + JSON.stringify(body));
            d.resolve(workerName);
        });
        return d.promise;
    });
};

GceInstance.prototype.destroy = function (workerName) {
    var self = this;
    var d = Q.defer();

    self.master.log('GceInstance', 'Destroying ' + workerName + '...');

    self._retrieveAccessToken(function (headers) {
        request({
            method: 'DELETE',
            uri: 'https://www.googleapis.com/compute/v1/projects/' + self.project + '/zones/' + self.zone + '/instances/' + workerName,
            headers: headers,
            json: true
        }, function (error, response, body) {
            self.master.log('GceInstance', 'Destroyed ' + workerName + ': ' + JSON.stringify(body));
            d.resolve();
        });
    });

    return d.promise;
};

GceInstance.prototype._executeCommand = function (command) {
    var self = this;

    var d = Q.defer();

    self.master.log('GceInstance', 'Start ' + command[0] + '...');

    var stdout = '';

    var spawned = spawn(command[2], command[3]);
    spawned.stdout.on('data', function (data) {
        self.master.log('GceInstance', data);
        stdout += data;
    });
    spawned.stderr.on('data', function (data) {
        self.master.log('GceInstance', data);
    });
    spawned.on('close', function (code) {
        if (code !== 0) {
            self.master.log('GceInstance', 'Returned with non-zero code: ' + code);
            d.reject();
        }

        self.master.log('GceInstance', 'Finished ' + command[0] + '.');

        setTimeout(function () {
            d.resolve(stdout);
        }, command[1] * 1000);
    });

    return d.promise;
};

GceInstance.prototype._executeCommands = function (commands) {
    var self = this;

    var p = Q(); // jshint ignore:line

    commands.map(function (command) {
        p = p.then(function () {
            return self._executeCommand(command);
        });
    });

    return p;
};

GceInstance.prototype._createFrancineImage = function () {
    var self = this;

    return self._executeCommands([
        ['creating builder instance', 30,
         'gcloud', ['compute', 'instances', 'create', 'francine-builder',
                    '--quiet',
                    '--project',       self.project,
                    '--zone',          self.zone,
                    '--machine-type',  self.workerMachineType,
                    '--image-project', 'ubuntu-os-cloud',
                    '--image',         'ubuntu-1410-utopic-v20150202']],
        ['copying francine package', 0,
         'gcloud', ['compute', 'copy-files',
                    self.master.getPackageName(), 'francine-builder:/home/peryaudo/',
                    '--quiet',
                    '--project', self.project,
                    '--zone',    self.zone]],
        ['extracting francine package', 0,
         'gcloud', ['compute', 'ssh', 'francine-builder',
                    '--command', 'tar xvf ' + self.master.getPackageShortName(),
                    '--quiet',
                    '--project', self.project,
                    '--zone',    self.zone]],
        ['executing setup script', 0,
         'gcloud', ['compute', 'ssh', 'francine-builder',
                    '--command', 'sudo /home/peryaudo/setup.sh gce',
                    '--quiet',
                    '--project', self.project,
                    '--zone',    self.zone]],
        ['terminating builder instance', 0,
         'gcloud', ['compute', 'instances', 'delete', 'francine-builder',
                    '--keep-disks', 'boot',
                    '--quiet',
                    '--project', self.project,
                    '--zone',    self.zone]],
        ['creating francine image', 0,
         'gcloud', ['compute', 'images', 'create', self.master.getPackageRevision(),
                    '--source-disk',      'francine-builder',
                    '--source-disk-zone', self.zone,
                    '--quiet',
                    '--project', self.project]],
        ['deleting builder instance disk', 0,
         'gcloud', ['compute', 'disks', 'delete', 'francine-builder',
                    '--quiet',
                    '--project', self.project,
                    '--zone',    self.zone]],
    ]);
};

GceInstance.prototype.setup = function (startMaster) {
    var self = this;

    return self._createFrancineImage()
    .then(function () {
        if (!startMaster) {
            return;
        }

        return self._executeCommands([
            ['creating network', 0,
             'gcloud', ['compute', 'networks', 'create', 'francine-cluster',
                        '--quiet',
                        '--project',       self.project]],
            ['adding external firewall rule', 0,
             'gcloud', ['compute', 'firewall-rules', 'create', 'external',
                        '--network',       'francine-cluster',
                        '--source-ranges', '0.0.0.0/0',
                        '--allow',         'tcp:22', 'tcp:3000',
                        '--quiet',
                        '--project',       self.project]],
            ['adding internal firewall rule', 0,
             'gcloud', ['compute', 'firewall-rules', 'create', 'internal',
                        '--network',       'francine-cluster',
                        '--source-ranges', '10.240.0.0/16',
                        '--allow',         'tcp:5000', 'tcp:9000',
                        '--quiet',
                        '--project',       self.project]],
            ['creating master instance', 30,
             'gcloud', ['compute', 'instances', 'create', 'francine-master',
                        '--quiet',
                        '--project',       self.project,
                        '--zone',          self.zone,
                        '--machine-type',  self.masterMachineType,
                        '--scopes',        'compute-rw',
                        '--image',         self.master.getPackageRevision(),
                        '--network',       'francine-cluster',
                        '--metadata',      'mode=master', 'image=' + self.master.getPackageRevision()]],
        ]);
    });
};

GceInstance.prototype.teardown = function () {
    var self = this;

    return self._executeCommand(
        ['listing all instances', 0,
         'gcloud', ['compute', 'instances', 'list',
                    '--quiet',
                    '--project', self.project,
                    '--format', 'json']])
    .then(function (raw) {
        var instances = JSON.parse(raw).map(function (instance) {
            return instance.name;
        }).filter(function (instanceName) {
            return instanceName.indexOf('francine-') === 0;
        });
        if (instances.length === 0) {
            return;
        }
        return self._executeCommands([
            ['deleting all instances', 0,
             'gcloud', ['compute', 'instances', 'delete'].concat(instances).concat(
                       ['--quiet',
                        '--project', self.project,
                        '--zone',    self.zone])],
        ]);
    })
    .then(function () {
        return self._executeCommand(
            ['listing all images', 0,
             'gcloud', ['compute', 'images', 'list',
                        '--quiet',
                        '--project', self.project,
                        '--format', 'json']]);
    })
    .then(function (raw) {
        var images = JSON.parse(raw).map(function (image) {
            return image.name;
        }).filter(function (imageName) {
            return imageName.indexOf('francine') === 0;
        });
        if (images.length === 0) {
            return;
        }
        return self._executeCommands([
            ['deleting all images', 0,
             'gcloud', ['compute', 'images', 'delete'].concat(images).concat(
                       ['--quiet',
                        '--project', self.project])],
        ]);
    })
    .then(function () {
        return self._executeCommands([
            ['deleting firewall rules', 0,
             'gcloud', ['compute', 'firewall-rules', 'delete', 'external', 'internal',
                        '--quiet',
                        '--project', self.project]],
            ['deleting network', 0,
             'gcloud', ['compute', 'networks', 'delete', 'francine-cluster',
                        '--quiet',
                        '--project', self.project]],
        ]);
    });
};

GceInstance.prototype.retrieveMetadata = function () {
    var self = this;
    var d = Q.defer();

    self.master.log('GceInstance', 'Retrieving metadata...');

    request({
        uri: 'http://metadata.google.internal/computeMetadata/v1/instance/attributes/?recursive=true',
        headers: {
            'Metadata-Flavor': 'Google'
        },
        json: true
    }, function (error, response, body) {
        if (error) {
            self.master.log('GceInstance', error);
            d.reject();
            return;
        }

        self.master.log('GceInstance', 'Metadata retrieved: ' + JSON.stringify(body));

        d.resolve(body);
    });

    return d.promise;
};

module.exports = GceInstance;

'use strict';

var request = require('request');
var spawn = require('child_process').spawn;

var GceInstance = function (master) {
    var self = this;

    self.master = master;
    self.workers = null;
    self.timestamp = -1;
    self.updateInterval = 60 * 1000;

    self.project = 'gcp-samples';
    self.zone = 'us-central1-a';
    self.masterMachineType = 'n1-standard-1';
    self.workerMachineType = 'n1-standard-1';
};

GceInstance.prototype.getTimestamp = function () {
    var self = this;

    return self.timestamp;
};

GceInstance.prototype._updateTimestamp = function () {
    var self = this;
    self.timestamp = new Date().getTime() | 0;
};

GceInstance.prototype.start = function () {
    var self = this;

    self.master.log('GceInstance', 'Instance information service started...');

    self._updateInformation();
};

GceInstance.prototype._retrieveAccessToken = function (done) {
    var self = this;
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
            return;
        }
        self.master.log('GceInstance', 'Retrieved service account token.');
        done({
            'Authorization': 'Bearer ' + body['access_token'] // jshint ignore:line
        });
    });
};

GceInstance.prototype._updateInformation = function () {
    var self = this;

    self.master.log('GceInstance', 'Updating instances information...');

    self._retrieveAccessToken(function (headers) {
        request({
            uri: 'https://www.googleapis.com/compute/v1/projects/' + self.project + '/zones/' + self.zone + '/instances',
            headers: headers,
            json: true
        }, function (error, response, body) {
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

            self.workers = {};

            instances.map(function (instance) {
                if (instance.name === 'francine-master') {
                    self.masterHost = instance.host;
                } else {
                    self.workers[instance.name] = instance;
                }
            });

            self._updateTimestamp();

            self.master.log('GceInstance', 'Finished updating instance information.');

            setTimeout(function () {
                self._updateInformation();
            }, self.updateInterval);
        });
    });
};

GceInstance.prototype.spawn = function (done) {
    var self = this;

    var workerName = 'francine-worker' + (new Date().getTime() | 0);

    self.master.log('GceInstance', 'Spawning new worker ' + workerName + '...');

    self.retrieveMetadata(function (metadata) {
        self._retrieveAccessToken(function (headers) {
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
                done(workerName);
            });
        });
    });

};

GceInstance.prototype.destroy = function (workerName, done) {
    var self = this;

    self.master.log('GceInstance', 'Destroying ' + workerName + '...');

    self._retrieveAccessToken(function (headers) {
        request({
            method: 'DELETE',
            uri: 'https://www.googleapis.com/compute/v1/projects/' + self.project + '/zones/' + self.zone + '/instances/' + workerName,
            headers: headers,
            json: true
        }, function (error, response, body) {
            self.master.log('GceInstance', 'Destroyed ' + workerName + ': ' + JSON.stringify(body));
            done();
        });
    });
};

GceInstance.prototype.getWorkers = function () {
    var self = this;

    return self.workers;
};

GceInstance.prototype.getMaster = function () {
    var self = this;

    return {
        host: self.masterHost,
        port: self.master.getPort()
    };
};

GceInstance.prototype._executeCommands = function (commands, done) {
    var self = this;

    (function loop () {
        if (commands.length === 0) {
            if (typeof done === 'function') {
                done();
            }
            return;
        }

        var command = commands.shift();

        self.master.log('GceInstance', 'Start ' + command[0] + '...');

        var spawned = spawn(command[2], command[3]);
        spawned.stdout.on('data', function (data) {
            self.master.log('GceInstance', data);
        });
        spawned.stderr.on('data', function (data) {
            self.master.log('GceInstance', data);
        });
        spawned.on('close', function (code) {
            if (code !== 0) {
                self.master.log('GceInstance', 'Returned with non-zero code: ' + code);
                return;
            }

            self.master.log('GceInstance', 'Finished ' + command[0] + '.');

            setTimeout(loop, command[1] * 1000);
        });
    })();
};

GceInstance.prototype._createFrancineImage = function (done) {
    var self = this;

    self._executeCommands([
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
        // TODO(peryaudo): reject build failure
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
    ], done);
};

GceInstance.prototype.setup = function (startMaster) {
    var self = this;

    self._createFrancineImage(function () {
        if (!startMaster) {
            return;
        }

        // TODO(peryaudo): Implement network group creation

        self._executeCommands([
            // ['creating network', 0,
            //  'gcloud', ['compute', 'networks', 'create', 'francine-cluster']
            // ],
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

    // TODO(peryaudo): Implement image deletion
    // TODO(peryaudo): Implement all instances deletion
    // TODO(peryaudo): Implement network group deletion
    self._executeCommands([
        ['deleting all instances', 0,
         'gcloud', ['compute', 'instances', 'delete', 'francine-master',
                    '--quiet',
                    '--project', self.project,
                    '--zone',    self.zone]],
    ]);
};

GceInstance.prototype.retrieveMetadata = function (done) {
    var self = this;

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
            return;
        }

        self.master.log('GceInstance', 'Metadata retrieved: ' + JSON.stringify(body));

        done(body);
    });
};

module.exports = GceInstance;

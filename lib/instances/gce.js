'use strict';

var spawn = require('child_process').spawn;

var GceInstance = function (master) {
    var self = this;

    self.master = master;
    self.timestamp = -1;
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
};

GceInstance.prototype.spawn = function (done) {
    var self = this;

};

GceInstance.prototype.destroy = function (workerName, done) {
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
                    '--project',       'gcp-samples',
                    '--zone',          'us-central1-a',
                    '--machine-type',  'n1-standard-1',
                    '--image-project', 'ubuntu-os-cloud',
                    '--image',         'ubuntu-1410-utopic-v20150202']],
        ['copying francine package', 0,
         'gcloud', ['compute', 'copy-files',
                    self.master.getPackageName(), 'francine-builder:/home/peryaudo/',
                    '--quiet',
                    '--project', 'gcp-samples',
                    '--zone',    'us-central1-a']],
        ['extracting francine package', 0,
         'gcloud', ['compute', 'ssh', 'francine-builder',
                    '--command', 'tar xvf ' + self.master.getPackageShortName(),
                    '--quiet',
                    '--project', 'gcp-samples',
                    '--zone',    'us-central1-a']],
        ['executing setup script', 0,
         'gcloud', ['compute', 'ssh', 'francine-builder',
                    '--command', 'sudo /home/peryaudo/setup.sh gce',
                    '--quiet',
                    '--project', 'gcp-samples',
                    '--zone',    'us-central1-a']],
        ['terminating builder instance', 0,
         'gcloud', ['compute', 'instances', 'delete', 'francine-builder',
                    '--keep-disks', 'boot',
                    '--quiet',
                    '--project', 'gcp-samples',
                    '--zone',    'us-central1-a']],
        ['creating francine image', 0,
         'gcloud', ['compute', 'images', 'create', self.master.getPackageRevision(),
                    '--source-disk',      'francine-builder',
                    '--source-disk-zone', 'us-central1-a',
                    '--quiet',
                    '--project', 'gcp-samples']],
        ['deleting builder instance disk', 0,
         'gcloud', ['compute', 'disks', 'delete', 'francine-builder',
                    '--quiet',
                    '--project', 'gcp-samples',
                    '--zone',    'us-central1-a']],
    ], done);
};

GceInstance.prototype.setup = function (startMaster) {
    var self = this;

    self._createFrancineImage(function () {
        if (!startMaster) {
            return;
        }

        self._executeCommands([
            ['creating master instance', 30,
             'gcloud', ['compute', 'instances', 'create', 'francine-master',
                        '--quiet',
                        '--project',       'gcp-samples',
                        '--zone',          'us-central1-a',
                        '--machine-type',  'n1-standard-1',
                        '--scopes',        'compute-rw',
                        '--image',         self.master.getPackageRevision()]],
        ]);
    });
};

GceInstance.prototype.teardown = function () {
    var self = this;

    self._executeCommands([
        ['deleting all instances', 0,
         'gcloud', ['compute', 'instances', 'delete', 'francine-builder',
                    '--quiet',
                    '--project', 'gcp-samples',
                    '--zone',    'us-central1-a']],
    ]);
};

GceInstance.prototype.retrieveMetadata = function (done) {
};

module.exports = GceInstance;

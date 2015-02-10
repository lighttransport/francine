'use strict';

var Q = require('q');
var spawn = require('child_process').spawn;

var GceInstance = require('./instances/gce');

var Deployer = function (argv) {
    var self = this;

    self.baseDirectory = argv.baseDirectory || (__dirname + '/..');

    self.teardown = argv.teardown;
    self.startMaster = argv.startMaster;

    self.revision = 'francine' + (Date.now() | 0);
    self.packageName = '/tmp/' + self.revision + '.tar.gz';
    self.packageShortName = self.revision + '.tar.gz';

    self.instance = null;
    self.instanceType = argv.instanceType || '(not set)';
};

Deployer.prototype.log = function (from, message) {
    console.log('Francine: ' + from + ': ' + message);
};

Deployer.prototype.getPackageName = function () {
    var self = this;
    return self.packageName;
};

Deployer.prototype.getPackageShortName = function () {
    var self = this;
    return self.packageShortName;
};

Deployer.prototype.getPackageRevision = function () {
    var self = this;
    return self.revision;
};

Deployer.prototype._package = function () {
    var self = this;
    var d = Q.defer();

    self.log('Deployer', 'Start packaging...');

    var tar = spawn('tar',
                    ['pczf',
                     self.packageName,
                     '--exclude', 'node_modules',
                     '.'], { cwd: self.baseDirectory });

    tar.stdout.on('data', function (data) {
        self.log('Deployer', data);
    });
    tar.stderr.on('data', function (data) {
        self.log('Deployer', data);
    });
    tar.on('close', function (code) {
        if (code !== 0) {
            self.log('AoProducer', 'Returned with non-zero code: ' + code);
            d.reject();
            return;
        }

        self.log('Deployer', 'Finished packaging.');

        d.resolve();
    });

    return d.promise;
};

Deployer.prototype.start = function () {
    var self = this;

    self.initializeInstance();

    if (self.teardown) {
        self.log('Deployer', 'Starting teardown...');
        self.instance.teardown();
        return;
    }

    self.log('Deployer', 'Start deploying... (Base directory: ' + self.baseDirectory + ')');

    self._package()
    .then(function () {
        return self.instance.setup(self.startMaster);
    });
};

Deployer.prototype.initializeInstance = function () {
    var self = this;

    switch (self.instanceType) {
        case 'gce':
            self.instance = new GceInstance(self);
            break;
    }

    if (!self.instance) {
        self.log('Deployer', 'Error: Invalid instance type ' + self.instanceType);
        process.exit(1);
    }

    self.log('Deployer', 'Instance type: ' + self.instanceType);
};

module.exports = Deployer;

'use strict';

var Q = require('q');
var spawn = require('child_process').spawn;

var GceInstance = require('./instances/gce');

function Deployer(argv) {
  var _this = this;

  _this.baseDirectory = argv.baseDirectory || (__dirname + '/..');

  _this.teardown = argv.teardown;
  _this.startMaster = argv.startMaster;

  _this.revision = 'francine' + (Date.now() | 0);
  _this.packageName = '/tmp/' + _this.revision + '.tar.gz';
  _this.packageShortName = _this.revision + '.tar.gz';

  _this.instance = null;
  _this.instanceType = argv.instanceType || '(not set)';
}

Deployer.prototype.log = function log(from, message) {
  console.log('Francine: ' + from + ': ' + message);
};

Deployer.prototype.getPackageName = function getPackageName() {
  var _this = this;
  return _this.packageName;
};

Deployer.prototype.getPackageShortName = function getPackageShortName() {
  var _this = this;
  return _this.packageShortName;
};

Deployer.prototype.getPackageRevision = function getPackageRevision() {
  var _this = this;
  return _this.revision;
};

Deployer.prototype._package = function _package() {
  var _this = this;
  var d = Q.defer();

  _this.log('Deployer', 'Start packaging...');

  var tar = spawn('tar',
          ['pczf',
           _this.packageName,
           '--exclude', 'node_modules',
           '.'], { cwd: _this.baseDirectory });

  tar.stdout.on('data', function(data) {
    _this.log('Deployer', data);
  });
  tar.stderr.on('data', function(data) {
    _this.log('Deployer', data);
  });
  tar.on('close', function(code) {
    if (code !== 0) {
      _this.log('AoProducer', 'Returned with non-zero code: ' + code);
      d.reject();
      return;
    }

    _this.log('Deployer', 'Finished packaging.');

    d.resolve();
  });

  return d.promise;
};

Deployer.prototype.start = function start() {
  var _this = this;

  _this.initializeInstance();

  if (_this.teardown) {
    _this.log('Deployer', 'Starting teardown...');
    _this.instance.teardown();
    return;
  }

  _this.log(
      'Deployer',
      'Start deploying... (Base directory: ' + _this.baseDirectory + ')');

  _this._package()
  .then(function() {
    return _this.instance.setup(_this.startMaster);
  });
};

Deployer.prototype.initializeInstance = function initializeInstance() {
  var _this = this;

  switch (_this.instanceType) {
    case 'gce':
      _this.instance = new GceInstance(_this);
      break;
  }

  if (!_this.instance) {
    _this.log('Deployer', 'Error: Invalid instance type ' + _this.instanceType);
    process.exit(1);
  }

  _this.log('Deployer', 'Instance type: ' + _this.instanceType);
};

module.exports = Deployer;

'use strict';

var Q = require('q');
var spawn = require('child_process').spawn;
var wrench = require('wrench');
var fs = require('fs');
var path = require('path');

var Runner = require('./runner');

var GceInstance = require('./instances/gce');

function Deployer(argv) {
  Runner.call(this, argv);

  this.baseDirectory = argv.baseDirectory || (__dirname + '/..');

  this.teardown = argv.teardown;
  this.startMaster = argv.startMaster;

  this.revision = 'francine' + (Date.now() | 0);
  this.packageDirectory = '/tmp/' + this.revision;
  this.packageName = '/tmp/' + this.revision + '.tar.gz';
  this.packageShortName = this.revision + '.tar.gz';
}

Deployer.prototype = Object.create(Runner.prototype);
Deployer.prototype.constructor = Deployer;

Deployer.prototype.getPackageName = function getPackageName() {
  return this.packageName;
};

Deployer.prototype.getPackageShortName = function getPackageShortName() {
  return this.packageShortName;
};

Deployer.prototype.getPackageRevision = function getPackageRevision() {
  return this.revision;
};

function _resolveTilde(given) {
  if (given.substr(0, 1) === '~') {
    given = process.env.HOME + given.substr(1);
  }
  return path.resolve(given);
}

Deployer.prototype._package = function _package() {
  var _this = this;
  var d = Q.defer();

  _this.log('Deployer', 'Start packaging...');

  wrench.copyDirSyncRecursive(_this.baseDirectory, _this.packageDirectory);

  if (_this.ltePath) {
    _this.ltePath = _resolveTilde(_this.ltePath);

    if (!fs.existsSync(_this.ltePath)) {
      _this.log('Deployer', _this.ltePath + ' does not exist');
      d.reject();
      return;
    }
    wrench.copyDirSyncRecursive(
        _this.ltePath,
        _this.packageDirectory + '/' + path.basename(_this.ltePath));
    _this.ltePath = '/root/' + path.basename(_this.ltePath);
  }

  if (_this.malliePath) {
    _this.malliePath = _resolveTilde(_this.malliePath);

    if (!fs.existsSync(_this.malliePath)) {
      _this.log('Deployer', _this.malliePath + ' does not exist');
      d.reject();
      return;
    }
    wrench.copyDirSyncRecursive(
        _this.malliePath,
        _this.packageDirectory + '/' + path.basename(_this.malliePath));
    _this.malliePath = '/root/' + path.basename(_this.malliePath);
  }

  _this.writeBackConfig(
    _this.packageDirectory + '/.francinerc',
    {
      ltePath: _this.ltePath,
      malliePath: _this.malliePath
    });

  var tar = spawn('tar',
          ['pczf',
           _this.packageName,
           '--exclude', 'node_modules',
           '.'], { cwd: _this.packageDirectory });

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

  _this.readConfig();
  _this.checkAndDefault();

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
      _this.instance = new GceInstance(_this, _this.gce);
      break;
  }

  if (!_this.instance) {
    _this.log('Deployer', 'Error: Invalid instance type ' + _this.instanceType);
    process.exit(1);
  }

  _this.log('Deployer', 'Instance type: ' + _this.instanceType);
};

module.exports = Deployer;

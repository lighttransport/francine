'use strict';

//
// Create image disk using ~/.francinerc description.
//

var Q = require('q');
var spawn = require('child_process').spawn;
var wrench = require('wrench');
var fs = require('fs');
var path = require('path');

var Runner = require('./runner');

var GceInstance = require('./instances/gce');

function ImageCreator(argv) {
  Runner.call(this, argv);

  this.readConfig(); // read image name from .francinerc

  this.baseDirectory = argv.baseDirectory || (__dirname + '/..');

  this.revision = 'francine-' + this.imageName;
  this.packageDirectory = '/tmp/' + this.revision;
  this.packageName = '/tmp/' + this.revision + '.tar.gz';
  this.packageShortName = this.revision + '.tar.gz';

  this.log('ImageCreator', 'image-name: ' + this.revision);
}

ImageCreator.prototype = Object.create(Runner.prototype);
ImageCreator.prototype.constructor = ImageCreator;

ImageCreator.prototype.getPackageName = function getPackageName() {
  return this.packageName;
};

ImageCreator.prototype.getPackageShortName = function getPackageShortName() {
  return this.packageShortName;
};

ImageCreator.prototype.getPackageRevision = function getPackageRevision() {
  return this.revision;
};

function _resolveTilde(given) {
  if (given.substr(0, 1) === '~') {
    given = process.env.HOME + given.substr(1);
  }
  return path.resolve(given);
}

ImageCreator.prototype._package = function _package() {
  var _this = this;
  var d = Q.defer();

  _this.log('ImageCreator', 'Start packaging...');

  // First clean previous dir and a file
  wrench.rmdirSyncRecursive(_this.packageDirectory);
  fs.unlinkSync(_this.packageName);

  wrench.copyDirSyncRecursive(_this.baseDirectory, _this.packageDirectory);

  if (_this.ltePath) {
    _this.ltePath = _resolveTilde(_this.ltePath);

    if (!fs.existsSync(_this.ltePath)) {
      _this.log('ImageCreator', _this.ltePath + ' does not exist');
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
      _this.log('ImageCreator', _this.malliePath + ' does not exist');
      d.reject();
      return;
    }
    wrench.copyDirSyncRecursive(
        _this.malliePath,
        _this.packageDirectory + '/' + path.basename(_this.malliePath));
    _this.malliePath = '/root/' + path.basename(_this.malliePath);
  }

  if (_this.nanogiexPath) {
    _this.nanogiexPath = _resolveTilde(_this.nanogiexPath);

    if (!fs.existsSync(_this.nanogiexPath)) {
      _this.log('ImageCreator', _this.nanogiexPath + ' does not exist');
      d.reject();
      return;
    }
    wrench.copyDirSyncRecursive(
        _this.nanogiexPath,
        _this.packageDirectory + '/' + path.basename(_this.nanogiexPath));
    _this.nanogiexPath = '/root/' + path.basename(_this.nanogiexPath);
  }

  _this.writeBackConfig(
    _this.packageDirectory + '/.francinerc',
    {
      ltePath: _this.ltePath,
      malliePath: _this.malliePath,
      nanogiexPath: _this.nanogiexPath
    });

  var tar = spawn('tar',
          ['pczf',
           _this.packageName,
           '--exclude', 'node_modules',
           '.'], { cwd: _this.packageDirectory });

  tar.stdout.on('data', function(data) {
    _this.log('ImageCreator', data);
  });
  tar.stderr.on('data', function(data) {
    _this.log('ImageCreator', data);
  });
  tar.on('close', function(code) {
    if (code !== 0) {
      _this.log('AoProducer', 'Returned with non-zero code: ' + code);
      d.reject();
      return;
    }

    _this.log('ImageCreator', 'Finished packaging.');

    d.resolve();
  });

  return d.promise;
};

ImageCreator.prototype.start = function start() {
  var _this = this;

  //_this.readConfig();
  _this.checkAndDefault();

  _this.initializeInstance();

  if (_this.teardown) {
    _this.log('ImageCreator', 'Starting teardown...');
    _this.instance.teardown();
    return;
  }

  _this.log(
      'ImageCreator',
      'Start image creation... (Base directory: ' + _this.baseDirectory + ')');

  _this._package()
  .then(function() {
    return _this.instance.createImage();
  });
};

ImageCreator.prototype.initializeInstance = function initializeInstance() {
  var _this = this;

  switch (_this.instanceType) {
    case 'gce':
      _this.instance = new GceInstance(_this, _this.gce);
      break;
  }

  if (!_this.instance) {
    _this.log('ImageCreator',
              'Error: Invalid instance type ' + _this.instanceType);
    process.exit(1);
  }

  _this.log('ImageCreator', 'Instance type: ' + _this.instanceType);
};

module.exports = ImageCreator;

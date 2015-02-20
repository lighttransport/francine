'use strict';

var Q = require('q');
var fork = require('child_process').fork;

var concatObject = require('../concat');

function LocalInstance(master) {
  var _this = this;

  _this.master = master;
  _this.workers = {};
  _this.currentPort = 5001;
  _this.currentResourcePort = 9000;
}

LocalInstance.prototype._spawn = function _spawn() {
  var _this = this;
  var d = Q.defer();

  var workerName = 'worker' + _this.currentPort;

  var process = fork('lib/main',
      ['--mode=worker',
       '--port=' + _this.currentPort,
       '--resourcePort=' + _this.currentResourcePort,
       '--temporaryDirectory=/tmp/francine/' + workerName], {});

  _this.workers[workerName] = {
    name: workerName,
    host: 'localhost',
    port: _this.currentPort,
    resourcePort: _this.currentResourcePort,
    process: process
  };

  _this.currentPort++;
  _this.currentResourcePort++;

  d.resolve(workerName);
  return d.promise;
};

LocalInstance.prototype.resize = function resize(size) {
  var _this = this;

  var needed = size - Object.keys(_this.workers).length;

  var q = Q(); // jshint ignore:line

  var spawning = function spawning(remain) {
    return function() {
      _this.master.log(
          'LocalInstance',
          'Spawn a new instance. Remaining: ' + remain);
      return _this._spawn();
    };
  };

  for (var i = needed; i > 0; i--) {
    q = q.then(spawning(i));
  }

  return q;
};

LocalInstance.prototype.destroy = function destroy(workerNames) {
  var _this = this;
  var d = Q.defer();

  workerNames.map(function(workerName) {
    var worker = _this.workers[workerName];

    worker.process.kill();

    delete _this.workers[workerName];
  });

  d.resolve();
  return d.promise;
};

LocalInstance.prototype.getInstances = function getInstances() {
  var _this = this;
  var d = Q.defer();

  d.resolve({
    master: {
      host: 'localhost',
      port: _this.master.getPort()
    },
    workers: concatObject({}, _this.workers)
  });

  return d.promise;
};

module.exports = LocalInstance;

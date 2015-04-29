'use strict';

var Q = require('q');
var spawn = require('child_process').spawn;
var fs = require('fs');

function LteProducer(worker, ltePath) {
  this.worker = worker;
  this.ltePath = ltePath;
}

LteProducer.prototype.produce = function produce(task) {
  var _this = this;
  var d = Q.defer();

  var spawned = spawn(
    this.ltePath + '/lte',
    [
      '--seed=' + task.seed.toString(),
      'teapot.json'
    ],
    {
      cwd: _this.worker.getTemporaryDirectory() + '/executions/' +
           task.execution.name
    });

  spawned.stdout.on('data', function(data) {
    _this.worker.log('LteProducer', data.toString('utf-8'));
  });

  spawned.stderr.on('data', function(data) {
    _this.worker.log('LteProducer', data.toString('utf-8'));
  });

  spawned.on('exit', function(code) {
    if (code !== 0) {
      _this.worker.log(
        'LteProducer',
        'Returned with non-zero code: ' + code);
      d.reject('Returned with non-zero code: ' + code);
      return;
    }

    fs.linkSync(
      _this.worker.getTemporaryDirectory() +
      '/executions/' + task.execution.name + '/output.jpg',
      _this.worker.getTemporaryDirectory() +
      '/results/' + task.name);

    d.resolve();
  });

  spawned.on('error', function(error) {
    d.reject(error);
  });

  // TODO(peryaudo): keep the process after the rendering finishes

  return d.promise;
};

LteProducer.prototype.deleteCache = function deleteCache(sessionName) {
  // TODO(peryaudo): kill the cached process
  return sessionName;
};

module.exports = LteProducer;

'use strict';

var Q = require('q');
var spawn = require('child_process').spawn;
var fs = require('fs');

function MallieProducer(worker, malliePath) {
  this.worker = worker;
  this.malliePath = malliePath;
}

MallieProducer.prototype.produce = function produce(task) {
  var _this = this;
  var d = Q.defer();

  var spawned = spawn(
    this.malliePath + '/bin/mallie',
    ['config.json', task.seed.toString()],
    {
      cwd: _this.worker.getTemporaryDirectory() + '/executions/' +
           task.execution.name
    });

  spawned.stdout.on('data', function(data) {
    _this.worker.log('MallieProducer', data.toString('utf-8'));
  });
  spawned.stderr.on('data', function(data) {
    _this.worker.log('MallieProducer', data.toString('utf-8'));
  });

  spawned.on('exit', function(code) {
    if (code !== 0) {
      _this.worker.log(
        'MallieProducer',
        'Returned with non-zero code: ' + code);
      d.reject('Returned with non-zero code: ' + code);
      return;
    }

    fs.linkSync(
      _this.worker.getTemporaryDirectory() +
      '/executions/' + task.execution.name + '/output.png',
      _this.worker.getTemporaryDirectory() +
      '/results/' + task.name);

    d.resolve();
  });

  spawned.on('error', function(error) {
    d.reject(error);
  });

  return d.promise;
};

MallieProducer.prototype.deleteCache = function deleteCache(sessionName) {
  // Nothing to do.
  return sessionName;
};

module.exports = MallieProducer;

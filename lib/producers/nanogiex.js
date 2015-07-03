'use strict';

var Q = require('q');
var spawn = require('child_process').spawn;
var fs = require('fs');

function NanogiexProducer(worker, nanogiexPath) {
  this.worker = worker;
  this.nanogiexPath = nanogiexPath;
}

NanogiexProducer.prototype.produce = function produce(task) {
  var _this = this;
  var d = Q.defer();

  var spawned = spawn(
    this.nanogiexPath + '/build/bin/ex43',
    [
      'pt',
      'scene.yml',
      'output.png',
      '512',
      '512',
      '10000000',
      '-m', '5'
    ],
    {
      cwd: _this.worker.getTemporaryDirectory() + '/executions/' +
           task.execution.name
    });

  //spawned.stdout.on('data', function(data) {
  //  _this.worker.log('NanogiexProducer', data.toString('utf-8'));
  //});
  //spawned.stderr.on('data', function(data) {
  //  _this.worker.log('NanogiexProducer', data.toString('utf-8'));
  //});

  spawned.on('exit', function(code) {
    if (code !== 0) {
      _this.worker.log(
        'NanogiexProducer',
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

NanogiexProducer.prototype.deleteCache = function deleteCache(sessionName) {
  // Nothing to do.
  return sessionName;
};

module.exports = NanogiexProducer;

'use strict';

var Q = require('q');
var spawn = require('child_process').spawn;

function AoProducer(worker) {
  var _this = this;
  _this.worker = worker;
}

AoProducer.prototype.produce = function produce(task) {
  var _this = this;
  var d = Q.defer();

  var output = _this.worker.getTemporaryDirectory() + '/results/' + task.name;

  var spawned = spawn(__dirname + '/../../ao', [output, task.seed.toString()]);

  spawned.stdout.on('data', function(data) {
    _this.worker.log('AoProducer', data.toString('utf-8'));
  });
  spawned.stderr.on('data', function(data) {
    _this.worker.log('AoProducer', data.toString('utf-8'));
  });
  spawned.on('close', function(code) {
    if (code !== 0) {
      _this.worker.log('AoProducer', 'Returned with non-zero code: ' + code);
      d.reject('Returned with non-zero code: ' + code);
      return;
    }

    d.resolve();
  });
  spawned.on('error', function(error) {
    d.reject(error);
  });

  return d.promise;
};

AoProducer.prototype.deleteCache = function deleteCache(sessionName) {
  // Nothing to do.
  return sessionName;
};

module.exports = AoProducer;

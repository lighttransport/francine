'use strict';

var Q = require('q');
var request = require('request');
var fs = require('fs');

function InternalResource(worker, session, source) {
  var _this = this;
  _this.worker = worker;
  _this.session = session;
  _this.source = source;
}

InternalResource.prototype._retrieve = function _retrieve(index) {
  var _this = this;
  var d = Q.defer();

  _this.worker.log('InternalResource', 'internal receiving');

  request({
    uri: 'http://' + _this.source.host + ':' + _this.source.resourcePort +
      '/sessions/' + _this.session.name + '/resource' + index,
    method: 'GET',
    encoding: null
  }, function(error, response, body) {
    if (error) {
      _this.worker.log('InternalResource', error);
      d.reject(error);
    } else {
      d.resolve(body);
    }
  });

  return d.promise;
};

// TODO(peryaudo): separate it to base class
InternalResource.prototype._save = function _save(filename, content) {
  var d = Q.defer();
  fs.writeFile(filename, content, function(error) {
    if (error) {
      d.reject(error);
    } else {
      d.resolve();
    }
  });
  return d.promise;
};

InternalResource.prototype.retrieve = function retrieve(file, destination) {
  var _this = this;
  return Q() // jshint ignore:line
  .then(function() {
    return _this._retrieve(file.index);
  })
  .then(function(content) {
    return _this._save(destination, content);
  });
};

module.exports = InternalResource;

'use strict';

var Q = require('q');
var fs = require('fs');
var request = require('request');

function DropboxResource() {
}

DropboxResource.prototype.initializeInMaster =
function initializeInMaster(master, config) {
  this.master = master;
  this.config = config;
};

DropboxResource.prototype.initializeInWorker =
function initializeInWorker(worker, token) {
  this.worker = worker;
  this.token = token;
};

DropboxResource.prototype.getAuthorizeUrl = function getAuthorizeUrl() {
  return 'https://www.dropbox.com/1/oauth2/authorize?' +
    'response_type=code&client_id=' + this.config.apiKey;
};

DropboxResource.prototype.generateResourceToken =
function generateResourceToken(code) {
  var _this = this;
  var d = Q.defer();

  request({
    uri: 'https://api.dropbox.com/1/oauth2/token',
    method: 'POST',
    form: {
      // jscs:disable
      'code': code,
      'grant_type': 'authorization_code',
      'client_id': _this.config.apiKey,
      'client_secret': _this.config.apiSecret,
      'redirect_uri': _this.config.redirectUri
      // jscs:enable
    },
    json: true
  }, function(error, response, body) {
    if (error) {
      d.reject(error);
      return;
    }
    d.resolve({
      // jscs:disable
      accessToken: body['access_token'], // jshint ignore:line
      tokenType: body['token_type'], // jshint ignore:line
      uid: body['uid'] // jshint ignore:line
      // jscs:enable
    });
  });

  return d.promise;
};

DropboxResource.prototype._retrieve = function _retrieve(path, token) {
  var _this = this;
  var d = Q.defer();
  _this.worker.log('DropboxResource', 'Dropbox receiving ' + path);
  request({
    uri: 'https://api-content.dropbox.com/1/files/auto/' + path,
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + token.accessToken
    },
    encoding: null
  }, function(error, response, body) {
    _this.worker.log('DropboxResource', 'Dropbox received ' + path);
    if (error) {
      _this.worker.log('DropboxResource', 'error dropbox: ' + error);
      d.reject(error);
    } else {
      d.resolve(body);
    }
  });

  return d.promise;
};

DropboxResource.prototype._save = function _save(filename, content) {
  var _this = this;
  var d = Q.defer();
  _this.worker.log('DropboxResource', 'save to ' + filename);
  fs.writeFile(filename, content, function(error) {
    if (error) {
      _this.worker.log('DropboxResource', 'error save: ' + error);
      d.reject(error);
    } else {
      d.resolve();
    }
  });
  return d.promise;
};

DropboxResource.prototype.retrieve = function retrieve(file, destination) {
  var _this = this;
  return Q() // jshint ignore:line
  .then(function() {
    return _this._retrieve(file.path, _this.token);
  })
  .then(function(content) {
    return _this._save(destination, content);
  });
};

module.exports = DropboxResource;

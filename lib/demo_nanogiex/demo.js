/*
 * Francine Demo using aobench.
 */
'use strict';

var argv = require('optimist').argv;
var express = require('express');
var http = require('http');
var socketio = require('socket.io');
var request = require('request');
var Q = require('q');

var app = express();
var server = http.Server(app);
var io = socketio(server);

if (argv._.length < 4) {
  console.warn('Usage: node lib/demo/demo [--usews]' +
    'HOST REST_PORT USER_NAME USER_PASSWORD');
  process.exit(1);
}

var host = argv._[0];
var port = argv._[1];
var userName = argv._[2];
var password = argv._[3];

// Resources from Dropbox
var resources = [
  {
    type: 'dropbox',
    path: '/nanogiex-resources/v4_016/Icosphere.obj',
    dst: 'Icosphere.obj'
  },
  {
    type: 'dropbox',
    path: '/nanogiex-resources/v4_016/Plane.000.obj',
    dst: 'Plane.000.obj'
  },
  {
    type: 'dropbox',
    path: '/nanogiex-resources/v4_016/Plane.001.obj',
    dst: 'Plane.001.obj'
  },
  {
    type: 'dropbox',
    path: '/nanogiex-resources/v4_016/Plane.002.obj',
    dst: 'Plane.002.obj'
  },
  {
    type: 'dropbox',
    path: '/nanogiex-resources/v4_016/scene.yml',
    dst: 'scene.yml'
  },
];

// Class that uses REST API to communicate with francine.
function FrancineRest(socket, parallel) {
  this._socket = socket;
  this._parallel = parallel;
}

FrancineRest.prototype.render = function render() {
  var _this = this;

  if (!_this.authorized) {
    console.log('render() called but not authorized!');
    return;
  }

  Q() // jshint ignore:line
  .then(function() {
    if (!_this.sessionName) {
      return _this._createSession();
    }
  })
  .then(function() {
    request({
      method: 'POST',
      uri: 'http://' + host + ':' + port +
        '/sessions/' + _this.sessionName + '/executions?block=true',
      encoding: null,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Token': _this.authToken
      },
      body: JSON.stringify({
        sessionName: _this.sessionName,
        parallel: _this._parallel,
        update: {}
      })
    }, function(error, response, body) {
      if (error) {
        console.log(error);
        return;
      }
      _this._socket.emit('updated', new Buffer(body).toString('base64'));
    });
  });
};

FrancineRest.prototype.init = function init() {
  var _this = this;
  return _this._auth()
  .then(function() {
    return _this._getAuthProvider();
  })
  .then(function(authStatus) {
    if (!authStatus.authroized) {
      _this._socket.emit('auth', authStatus.authorizeUrl);
    } else {
      _this.authorized = true;
      _this.render();
    }
  });
};

FrancineRest.prototype.auth = function auth(token) {
  var _this = this;
  return _this._setAuthProvider(token)
  .then(function() {
    _this.authorized = true;
    _this.render();
  }, function() {
    return _this.init();
  });
};

FrancineRest.prototype._auth = function _auth() {
  var _this = this;
  var d = Q.defer();
  request({
    method: 'POST',
    uri: 'http://' + host + ':' + port + '/auth',
    json: true,
    body: {
      userName: userName,
      password: password
    }
  }, function(error, response, body) {
    if (error || body.error) {
      console.log(error || body.error);
      d.reject();
      return;
    }

    _this.authToken = body.authToken;
    d.resolve();
  });
  return d.promise;
};

FrancineRest.prototype._getAuthProvider = function _getAuthProvider() {
  var _this = this;
  var d = Q.defer();
  request({
    method: 'GET',
    uri: 'http://' + host + ':' + port + '/auth/dropbox',
    headers: {
      'X-API-Token': _this.authToken
    },
    json: true
  }, function(error, response, body) {
    if (error) {
      console.log(error);
      d.reject();
      return;
    }

    d.resolve(body);
  });
  return d.promise;
};

FrancineRest.prototype._setAuthProvider = function _setAuthProvider(code) {
  var _this = this;
  var d = Q.defer();
  request({
    method: 'POST',
    uri: 'http://' + host + ':' + port + '/auth/dropbox',
    json: true,
    headers: {
      'X-API-Token': _this.authToken
    },
    body: {
      code: code
    }
  }, function(error, response, body) {
    if (error || body.error) {
      console.log(error);
      d.reject();
      return;
    }

    d.resolve();
  });

  return d.promise;
};

FrancineRest.prototype._createSession = function _createSession() {
  var _this = this;

  var d = Q.defer();

  request({
    method: 'POST',
    uri: 'http://' + host + ':' + port + '/sessions',
    json: true,
    headers: {
      'X-API-Token': _this.authToken
    },
    body: {
      producer: 'nanogiex',
      format: 'jpg',
      resources: resources
    }
  }, function(error, response, body) {
    if (error || body.error) {
      console.log(error || body.error);
      d.reject();
      return;
    }

    _this.sessionName = body.name;

    d.resolve();
  });

  return d.promise;
};

FrancineRest.prototype.close = function close() {
  var _this = this;

  if (!_this.sessionName) {
    return;
  }

  request({
    method: 'DELETE',
    uri: 'http://' + host + ':' + port + '/sessions/' + _this.sessionName,
    json: true
  }, function(error, response, body) {
    // Suppress warning
    error = error;
    response = response;
    body = body;
  });
};

app.get('/', function(req, res) {
  res.sendFile(__dirname + '/index.html');
});

app.get('/client.js', function(req, res) {
  res.sendFile(__dirname + '/client.js');
});

io.on('connection', function(socket) {
  console.log('connected');

  var francine = new FrancineRest(socket, /* parallel = */ 8);

  francine.init();

  socket.on('auth', function(token) {
    francine.auth(token);
  });

  socket.on('disconnect', function() {
    console.log('disconnected');
    francine.close();
  });
});

server.listen(4500, function() {
  console.log('francine demo listening on 4500');
});

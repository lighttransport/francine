'use strict';

var argv = require('optimist').argv;
var express = require('express');
var http = require('http');
var socketio = require('socket.io');
var request = require('request');

var app = express();
var server = http.Server(app);
var io = socketio(server);

if (argv._.length < 2) {
  console.warn('Usage: node lib/demo/demo HOST REST_PORT');
  process.exit(1);
}

var host = argv._[0];
var port = argv._[1];

function Francine(socket) {
  this._socket = socket;
  this._parallel = 4;
}

Francine.prototype.render = function render(view) {
  var _this = this;

  if (!_this.sessionName) {
    _this._createSession();
    return;
  }

  request({
    method: 'POST',
    uri: 'http://' + host + ':' + port +
      '/sessions/' + _this.sessionName + '/executions?block=true',
    encoding: null,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sessionName: _this.sessionName,
      parallel: _this._parallel,
      update: view
    })
  }, function(error, response, body) {
    if (error) {
      console.log(error);
      return;
    }
    _this._socket.emit('updated', new Buffer(body).toString('base64'));
  });
};

Francine.prototype._createSession = function _createSession() {
  var _this = this;

  request({
    method: 'POST',
    uri: 'http://' + host + ':' + port + '/sessions',
    json: true,
    body: {
      producer: 'lte',
      format: 'jpg',
      resources: [
        {
          type: 'dropbox',
          path: '/lteteapot/raytrace.c',
          dst: 'raytrace.c'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/shaders.json',
          dst: 'shaders.json'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/teapot_scene.json',
          dst: 'teapot_scene.json'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/teapot.json',
          dst: 'teapot.json'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/teapot.material.json',
          dst: 'teapot.material.json'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/teapot.mesh',
          dst: 'teapot.mesh'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/texture.c',
          dst: 'texture.c'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/shader.h',
          dst: 'shader.h'
        },
        {
          type: 'dropbox',
          path: '/lteteapot/light.h',
          dst: 'light.h'
        }
      ]
    }
  }, function(error, response, body) {
    if (error) {
      console.log(error);
      return;
    }

    _this.sessionName = body.name;

    _this._socket.emit('auth',
      'http://' + host + ':' + port +
      '/oauth2/dropbox?sessionName=' + _this.sessionName);
  });
};

Francine.prototype.close = function close() {
  var _this = this;

  if (!_this.sessionName) {
    return;
  }

  request({
    method: 'DELETE',
    uri: 'http://' + host + ':' + port + '/sessions/' + _this.sessionName,
    json: true
  }, function(error, response, body) {
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

  var francine = new Francine(socket);

  francine.render();

  socket.on('view_changed', function(view) {
    francine.render({
      'view_changed': {
        set: {
          eye: view.eye,
          lookat: view.lookat,
          up: [0, 1, 0],
          fov: 45
        }
      }
    });
  });

  socket.on('disconnect', function() {
    console.log('disconnected');
    francine.close();
  });
});

server.listen(4500, function() {
  console.log('francine demo listening on 4500');
});

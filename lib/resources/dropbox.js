'use strict';

var Q = require('q');
var fs = require('fs');
var request = require('request');

var DropboxResource = function () {
    var self = this;
    self.token = null;
};

DropboxResource.prototype.initializeInMaster = function (master, config) {
    var self = this;
    self.master = master;
    self.config = config;
};

DropboxResource.prototype.initializeInWorker = function (worker, token) {
    var self = this;
    self.worker = worker;
    self.token = token;
};

// TODO(peryaudo): separate oauth token per user
DropboxResource.prototype.getToken = function () {
    var self = this;
    return self.token;
};

DropboxResource.prototype.registerEndpoint = function (app) {
    var self = this;

    app.get('/oauth2/dropbox', function (req, res) {
        if (!req.query.error && !req.query.code) {
            if (self.config.redirectUri) {
                res.redirect('https://www.dropbox.com/1/oauth2/authorize' +
                        '?redirect_uri=' + encodeURIComponent(self.config.redirectUri) +
                        '&response_type=code' +
                        '&client_id=' + self.config.apiKey);
            } else {
                res.end(
                    '<html>' +
                    '<body>' +
                    '<div><form>Authentication code: <input name=code type=text><input type=submit value="register"></form></div>' +
                    '<div>Get authentication code from <a href="https://www.dropbox.com/1/oauth2/authorize?response_type=code&client_id=' + self.config.apiKey + '" target="_blank">here</a></div>' +
                    '</body>' +
                    '</html>');
            }
            return;
        }

        if (req.query.error) {
            res.end(req.query.error);
            return;
        }

        request({
            uri: 'https://api.dropbox.com/1/oauth2/token',
            method: 'POST',
            form: {
                'code': req.query.code,
                'grant_type': 'authorization_code',
                'client_id': self.config.apiKey,
                'client_secret': self.config.apiSecret,
                'redirect_uri': self.config.redirectUri
            },
            json: true
        }, function (error, response, body) {
            if (error) {
                res.end(error);
                return;
            }
            self.token = {
                accessToken: body['access_token'], // jshint ignore:line
                tokenType: body['token_type'], // jshint ignore:line
                uid: body['uid'] // jshint ignore:line
            };
            res.end('OAuth2 successful');
        });
    });
};

DropboxResource.prototype._retrieve = function (path, token) {
    var self = this;
    var d = Q.defer();
    self.worker.log('DropboxResource', 'Dropbox receiving ' + path);
    request({
        uri: 'https://api-content.dropbox.com/1/files/auto/' + path,
        method: 'GET',
        headers: {
            Authorization: 'Bearer ' + token.accessToken
        },
        encoding: null
    }, function (error, response, body) {
        self.worker.log('DropboxResource', 'Dropbox received ' + path);
        if (error) {
            self.worker.log('DropboxResource', 'error dropbox: ' + error);
            d.reject(error);
        } else {
            d.resolve(body);
        }
    });

    return d.promise;
};

DropboxResource.prototype._save = function (filename, content) {
    var self = this;
    var d = Q.defer();
    self.worker.log('DropboxResource', 'save to ' + filename);
    fs.writeFile(filename, content, function (error) {
        if (error) {
            self.worker.log('DropboxResource', 'error save: ' + error);
            d.reject(error);
        } else {
            d.resolve();
        }
    });
    return d.promise;
};

DropboxResource.prototype.retrieve = function (file, destination) {
    var self = this;
    return Q() // jshint ignore:line
    .then(function () {
        return self._retrieve(file.path, self.token);
    })
    .then(function (content) {
        return self._save(destination, content);
    });
};

module.exports = DropboxResource;

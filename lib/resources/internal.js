'use strict';

var Q = require('q');
var request = require('request');
var fs = require('fs');

var InternalResource = function (worker, session, source) {
    var self = this;
    self.worker = worker;
    self.session = session;
    self.source = source;
};

InternalResource.prototype._retrieve = function (index) {
    var self = this;
    var d = Q.defer();

    self.worker.log('InternalResource', 'internal receiving');

    request({
        uri: 'http://' + self.source.host + ':' + self.source.resourcePort + '/sessions/' + self.session.name + '/resource' + index,
        method: 'GET',
        encoding: null
    }, function (error, response, body) {
        if (error) {
            self.worker.log('InternalResource', error);
            d.reject(error);
        } else {
            d.resolve(body);
        }
    });

    return d.promise;
};

// TODO(peryaudo): separate it to base class
InternalResource.prototype._save = function (filename, content) {
    var d = Q.defer();
    fs.writeFile(filename, content, function (error) {
        if (error) {
            d.reject(error);
        } else {
            d.resolve();
        }
    });
    return d.promise;
};

InternalResource.prototype.retrieve = function (file, destination) {
    var self = this;
    return Q() // jshint ignore:line
    .then(function () {
        return self._retrieve(file.index);
    })
    .then(function (content) {
        return self._save(destination, content);
    });
};

module.exports = InternalResource;

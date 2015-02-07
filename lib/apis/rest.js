'use strict';

var express = require('express');

var initializeRestApi = function (master, scheduler) {
    var app = express();

    app.get('/', function (req, res) {
        master.log('RestApi', 'received request ...');
        var sessionName = scheduler.createSession({});
        scheduler.createExecution({ sessionName: sessionName }, function (image, error) {
            if (error) {
                master.log('RestApi', 'Error: ' + error);
                res.end('Francine: Error: ' + error);
            } else {
                res.end(image);
            }
            scheduler.deleteSession(sessionName);
        });
    });

    app.listen(master.getRestPort(), function () {
        master.log('RestApi', 'Waiting on REST port ' + master.getRestPort() + ' for REST API request...');
    });

    return app;
};

module.exports = initializeRestApi;

'use strict';

var StaticInstanceManager = function (instance, master, number) {
    var self = this;

    self.instance = instance;
    self.master = master;
    self.number = number;
    self.manageInterval = 30 * 1000;
};

StaticInstanceManager.prototype.start = function () {
    var self = this;

    self.manage();
};

StaticInstanceManager.prototype.manage = function () {
    var self = this;

    console.log('Francine: StaticInstanceManager: managing instance...');

    (function loop (remain) {
        if (remain <= 0) {
            console.log('Francine: StaticInstanceManager: instance spawn finished.');

            setTimeout(function () {
                self.manage();
            }, self.manageInterval);

            return;
        }

        console.log('Francine: StaticInstanceManager: spawn a new instance. remaining: ' + remain);

        self.instance.spawn(function () {
            loop(remain - 1);
        });
    })(self.number - Object.keys(self.instance.getWorkers()).length);
};

module.exports = StaticInstanceManager;

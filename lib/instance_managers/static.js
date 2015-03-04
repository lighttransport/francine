'use strict';

function StaticInstanceManager(master, number) {
  var _this = this;

  _this.master = master;
  _this.number = number;
}

StaticInstanceManager.prototype.manage = function manage() {
  var _this = this;

  _this.master.log('StaticInstanceManager', 'Resizing to ' + _this.number);

  return _this.master.resizeWorkers(_this.number);
};

module.exports = StaticInstanceManager;

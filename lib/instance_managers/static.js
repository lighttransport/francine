'use strict';

function StaticInstanceManager(master, number) {
  var _this = this;

  _this.master = master;
  _this.number = number;
}

StaticInstanceManager.prototype.manage = function manage() {
  var _this = this;

  return _this.master.resizeWorkers(_this.number);
};

module.exports = StaticInstanceManager;

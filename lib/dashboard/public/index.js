'use strict';

// jshint ignore:start
var socket = io.connect(location.protocol + '//' + location.host);

socket.on('init', function init(state) {
  draw(state);
});

socket.on('change', function init(state) {
  draw(state);
});
// jshint ignore:end

function draw(state) {
  var radius = 16;

  var margin = {
    top: 30,
    right: 20,
    bottom: 20,
    left: 20
  };

  var columns = 30;
  var rows = (state.workers.length / columns | 0) + 1;

  var width = radius * Math.sqrt(3) * columns;
  var height = radius * 2 * rows + 100;

  var hexbin = d3.hexbin().radius(radius);

  var points = [];
  for (var i = 0; i < columns; i++) {
    for (var j = 0; j < rows; j++) {
      points.push([radius * i * 1.75, radius * j * 1.5]);
    }
  }

  var dom = document.getElementById('chart');  // jshint ignore:line
  while (dom.firstChild) {
    dom.removeChild(dom.firstChild);
  }

  var svg = d3.select('#chart').append('svg')
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

  svg.append('g')
    .selectAll('.hexagon')
    .data(hexbin(points))
    .enter().append('path')
    .attr('class', 'hexagon')
    .attr('d', function(d) {
      return 'M' + d.x + ',' + d.y + hexbin.hexagon();
    })
    .attr('stroke', '#fff')
    .attr('stroke-width', '1px')
    .style('fill', function(d, i) {
      if (i >= state.workers.length) {
        return '#fff';
      }

      switch (state.workers[i]) {
        case 'UNUSED':
          return '#f5f5f5';
        case 'REDUCING':
          return '#ffb74d';
        case 'PRODUCING':
          return '#64b5f6';
      }
    });
}

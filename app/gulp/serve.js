/**
 * Created by gaowhen on 15/7/10.
 */

var gulp = require('gulp')
var child = require('child_process')

gulp.task('serve', function () {
	var server = child.spawn('python', ['flaskr.py']);
})

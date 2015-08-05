/**
 * Created by gaowhen on 15/7/20.
 */
var gulp = require('gulp')
var config = require('config').gulp
var replace = require('gulp-replace')

var REGEX = global.REGEX
var REG_BUILD = global.REG_BUILD

gulp.task('html', function () {
	gulp.src(config.src.template + '/**/*.html')
		.pipe(replace(REGEX, REG_BUILD))
		.pipe(gulp.dest(config.dist.template))
})

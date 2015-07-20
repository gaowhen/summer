var gulp = require('gulp')
var config = require('config').gulp
var watch = require('gulp-watch')
var watchify = require('./watchify')
var image = require('./image')
var stylus = require('./stylus')
var html = require('./html')
var debug = require('gulp-debug')

require('./base-js')

gulp.task('watch', ['base-js', 'watchify', 'stylus', 'image', 'html'], function () {
	watch(config.src.js + '/**/*.js', ['watchify'])

	// TO FIX
	// watch does not work
	// path cannot start with .
	watch('fe/static/img/**/*.+(png|gif|jpg|eot|woff|ttf|svg|ico)', function () {
		return gulp.src('fe/static/img/**/*.+(png|gif|jpg|eot|woff|ttf|svg|ico)')
			.pipe(debug())
			.pipe(gulp.dest(config.dist.img))
	})

	watch(config.src.css + '/**/*.styl', ['stylus'])

	watch(config.src.template + '/**/*.html', ['html'])

})

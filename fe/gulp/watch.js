var gulp = require('gulp')
var config = require('config').gulp
var watch = require('gulp-watch')
var watchify = require('./watchify')
var image = require('./image')
var stylus = require('./stylus')
var html = require('./html')

require('./base-js')

gulp.task('watch', ['base-js', 'watchify', 'stylus', 'image', 'html'], function () {
	watch(config.src.js + '/**/*.js', function () {
		gulp.start('watchify')
	})

	// TO FIX
	// watch does not work
	watch(config.src.img + '/**/*.+(png|gif|jpg|eot|woff|ttf|svg|ico)', function (file) {
		gulp.start('image')
	})

	watch(config.src.css + '/**/*.styl', function () {
		gulp.start('stylus')
	})

	watch(config.src.template + '/**/*.html', function () {
		gulp.start('html')
	})

})

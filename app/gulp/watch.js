var gulp = require('gulp')
var config = require('config').gulp
var watch = require('gulp-watch')
var watchify = require('./watchify')
var image = require('./image')
var stylus = require('./stylus')

gulp.task('watch', ['image', 'watchify'], function () {
	watch(config.src.js + '/**/*.js', function () {
		gulp.start('watchify')
	})

	watch(config.src.img + '/**/*.+(png|gif|jpg|ico)', function () {
		gulp.start('image')
	})

	watch(config.src.css + '/**/*.styl', function () {
		gulp.start('stylus')
	})
})

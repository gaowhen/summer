var gulp = require('gulp')
var config = require('config').gulp
var watch = require('gulp-watch')
var watchify = require('./watchify')
var image = require('./image')

gulp.task('dev', ['image', 'watchify'], function () {
	watch(config.src.js + '/**/*.js', function () {
		gulp.start('watchify')
	})

	watch(config.src.img + '/**/*.+(png|gif|jpg|ico)', function () {
		console.log('watch image')
		gulp.start('image')
	})
})

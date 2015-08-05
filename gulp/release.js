/**
 * Created by gaowhen on 15/8/5.
 */

var gulp = require('gulp')
var config = require('config').gulp
var rev = require('gulp-rev')
var uglify = require('gulp-uglify')
var replace = require('gulp-replace')
var del = require('del')
var path = require('path')
var debug = require('gulp-debug')
var log = require('gulp-util').log

function replaceFunc(match, p1) {
	var manifest = require(global.MANIFEST)
	log('/static/' + manifest[p1])
	return '/static/' + manifest[p1]
}

gulp.task('build', ['browserify', 'base-js', 'stylus'], function () {
	return gulp.src([
		config.src.js + '/**/*.js',
		'!' + config.src.js + '/**/*_.js'
	])
		.pipe(uglify({
			output: {
				ascii_only: true
			},
			compress: {
				drop_console: true
			}
		}))
		.pipe(gulp.dest(config.dist.js))
})

gulp.task('rev', ['build'], function() {
	return gulp.src([
		config.dist.css + '/**/*.css',
		config.dist.js + '/**/*.js',
		'!' + config.dist.js + '/**/_*.js',
		config.dist.img + '/**/*.+(png|gif|jpg|eot|woff|ttf|svg|ico)'
	], {
		base: config.release.path
	})
	.pipe(gulp.dest(config.dist.path))
	.pipe(rev())
	.pipe(gulp.dest(config.release.path))
	.pipe(rev.manifest())
	.pipe(gulp.dest(config.dist.path))
})

gulp.task('static-replace', ['rev'], function() {
	return gulp.src([
		config.release.css + '/*.css',
		config.release.js + '/**/*.js'
	])
		.pipe(replace(global.REGEX, replaceFunc))
		.pipe(gulp.dest(config.release.path))
})

gulp.task('html-replace', ['static-replace'], function() {
	return gulp.src(config.release.html + '/**/*.html')
		.pipe(replace(global.REGEX, replaceFunc))
		.pipe(gulp.dest(config.release.html))
})

gulp.task('release', ['html-replace'])
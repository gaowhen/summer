/**
 * Created by gaowhen on 15/8/5.
 */

var gulp = require('gulp')
var config = require('config').gulp
var rev = require('gulp-rev')
var uglify = require('gulp-uglify')
var replace = require('gulp-replace')
var include = require('gulp-include')

function replaceFunc(match, p1) {
	var manifest = require(global.MANIFEST)

	return '/static/' + manifest[p1]
}

gulp.task('copy-image', function () {
	return gulp.src(config.dist.img + '/**/*.+(png|gif|jpg|eot|woff|ttf|svg|ico)')
			.pipe(gulp.dest(config.release.img))
})

gulp.task('uglify', ['browserify', 'stylus', 'base-js', 'copy-image'], function () {
	return gulp.src([
		config.dist.js + '/*.js',
		'!' + config.dist.js + '/base.js'
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

gulp.task('rev', ['uglify'], function() {
	return gulp.src([
		config.dist.css + '/*.css',
		config.dist.js + '/*.js'
	], {
		base: config.dist.path
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
		config.release.js + '/*.js'
	], {
		base: config.release.path
	})
		.pipe(replace(global.REGEX, replaceFunc))
		.pipe(gulp.dest(config.release.path))
})

gulp.task('html-replace', ['static-replace'], function() {
	return gulp.src(config.release.html + '/**/*.html')
		.pipe(replace(global.REGEX, replaceFunc))
		.pipe(gulp.dest(config.release.html))
})

gulp.task('release', ['html-replace'])
/**
 * Created by gaowhen on 15/7/10.
 */

var gulp = require('gulp')
var nib = require('nib')
var stylus = require('gulp-stylus')
var jeet = require('jeet')
var config = require('config').gulp
var sourcemaps = require('gulp-sourcemaps')
var replace = require('gulp-replace')

var REGEX = global.REGEX
var REG_BUILD = global.REG_BUILD

gulp.task('stylus', function () {
	return gulp.src([
		config.src.css + '/**/*.styl',
		'!' + config.src.css + '/**/_*.styl'
	])
			.pipe(sourcemaps.init())
			.pipe(stylus({use: [nib(), jeet()], import: ['nib', 'jeet'], 'include css': true}))
			.pipe(replace(REGEX, REG_BUILD))
			.pipe(sourcemaps.write('./map'))
			.pipe(gulp.dest(config.dist.css))
})

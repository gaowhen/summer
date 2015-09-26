# -*- coding: utf-8 -*-

import os

basedir = os.path.abspath(os.path.dirname(__file__))


class Config():
    DEBUG = True
    META_KEYWORD = 'Miko Gao, 糖伴西红柿, blog, mindfire, startup, f2e, 前端, 创业'
    META_DESCRIPTION = 'Miko Gao 糖伴西红柿 的博客，谈论创业、前端技术'
    AUTHOR = 'Miko Gao aka 糖伴西红柿'
    TWITTER = 'https://twitter.com/gaowhen'
    REPO = 'https://github.com/gaowhen/gaowhen.github.io.git'


class DevConfig(Config):
    SITE_NAME = 'Summer'
    SUBTITLE = '「厌恶争执 不善言说」'
    DOMAIN = 'http://gaowhen.dev/'
    DATABASE_URI = os.path.join(basedir, 'data-dev.db')


class TestConfig(Config):
    SITE_NAME = 'Test'
    SUBTITLE = '「东张西望 一无所长」'
    DOMAIN = 'http://gaowhen.dev/'
    DATABASE_URI = os.path.join(basedir, 'data-test.db')


class ProductConfig(Config):
    SITE_NAME = 'GaoWhen高H温'
    SUBTITLE = '「文不能测字 武不能防身」'
    DOMAIN = 'http://gaowhen.com/'
    DATABASE_URI = os.path.join(basedir, 'blog.db')


config = dict(
    dev=DevConfig,
    test=TestConfig,
    product=ProductConfig
)

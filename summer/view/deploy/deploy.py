# -*- coding: utf-8 -*-

from flask import Blueprint, jsonify
from git import Repo, Actor

from summer.config import REPO


bp = Blueprint('deploy', __name__)


@bp.route('/deploy', methods=['POST'])
def deploy():
	repo_path = './ghpages'
	repo_url = REPO

	repo = Repo(repo_path)

	if (repo.bare):
		repo = Repo.init(repo_path, bare=True)

	index = repo.index

	for diff in index.diff(None):
		print diff.a_blob
		index.add([diff.a_blob])
	#index.add([diff.a_blob.name for diff in index.diff(None)])

	for untracked in repo.untracked_files:
		print 'untracked'
		print untracked
		index.add([untracked])

	index.commit('new commit')
	repo.git.push()

	return jsonify(r=True)

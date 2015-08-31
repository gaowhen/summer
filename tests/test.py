# -*- coding: utf-8 -*-

import unittest
from contextlib import closing

from slugify import slugify
from datetime import datetime

from flask import current_app

from summer.app import create_app
from summer.db.connect import get_db
from summer.model.entry import Entry

class BaseTestCase(unittest.TestCase):

	def setUp(self):
		self.app = create_app('test')
		self.app_context = self.app.app_context()
		self.app_context.push()

		self.db = get_db()

		with open('./summer/schema.sql', mode='r') as f:
			self.db.cursor().executescript(f.read())
			self.db.commit()

	def tearDown(self):
		self.db.execute('drop table if exists entries')
		self.app_context.pop()

	def test_app_exists(self):
		self.assertFalse(current_app is None)

	def test_save_draft(self):
		title = '十万嬉皮'.decode('utf-8')
		slug = slugify(title)
		content = '大梦一场 的董二千先生\
                   推开窗户 举起望远镜\
                   眼底映出 一阵浓烟\
                   前已无通路 后不见归途\
                   敌视现实 虚构远方\
                   东张西望 一无所长\
                   四体不勤 五谷不分\
                   文不能测字 武不能防身\
                   喜欢养狗 不爱洗头\
                   不事劳作 一无所获\
                   厌恶争执 不善言说\
                   终于沦为 沉默的帮凶\
                   借酒消愁 不太能喝\
                   蛊惑他人 麻醉内心\
                   浇上汽油 舒展眉头\
                   纵火的青年 迫近的时间\
                   大梦一场 的董二千先生\
                   推开窗户 举起望远镜\
                   眼底映出 一阵浓烟\
                   前已无通路 后不见归途'.decode('utf-8')

		date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
		entry = Entry.save_draft(title, content, date, slug)

		self.assertTrue(entry)
		self.assertEqual(entry['title'], title)
		self.assertEqual(entry['slug'], slug)
		self.assertEqual(entry['content'], content)
		self.assertEqual(entry['create_time'], date)
		self.assertEqual(entry['status'], 'draft')

	def test_update_draft(self):
		title = '秦皇岛'.decode('utf-8')
		content = '站在能分割世界的桥\
                   还是看不清 在那些时刻\
                   遮蔽我们 黑暗的心 究竟是什么\
                   住在我心里孤独的\
                   孤独的海怪 痛苦之王\
                   开始厌倦 深海的光 停滞的海浪\
                   站在能看到灯火的桥\
                   还是看不清 在那些夜晚\
                   照亮我们 黑暗的心 究竟是什么\
                   于是他默默追逐着\
                   横渡海峡 年轻的人\
                   看着他们 为了彼岸\
                   骄傲地 骄傲的 灭亡'.decode('utf-8')

		entry = Entry.update(title, content, 1)
		print entry

		self.assertTrue(entry)
		self.assertEqual(entry['title'], title)
		self.assertEqual(entry['content'], content)
		self.assertEqual(entry['status'], 'draft')

if __name__ == '__main__':
    unittest.main()

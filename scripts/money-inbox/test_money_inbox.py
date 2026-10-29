import unittest, datetime as dt
from money_inbox import mac_ts
from classify import classify
class Ingest(unittest.TestCase):
 def test_epochs(self):
  expected=dt.datetime(2026,10,28,22,42,tzinfo=dt.timezone.utc)
  seconds=expected.timestamp()-978307200
  self.assertEqual(mac_ts(seconds),expected)
  self.assertEqual(mac_ts(seconds*1e9),expected)
 def test_topics(self):
  for text,topic in [('Can I join your team?','join_team'),('Can I rent a car from you?','car_rental'),('Need extra income','income'),('What are my next steps?','next_steps')]:
   result=classify(text);self.assertIn(topic,result['topics']);self.assertEqual(result['priority'],1)
 def test_privacy_over_money(self):
  self.assertTrue(classify('Can I join the team?\nI love you babe')['private'])
  self.assertFalse(classify('My state licensing exam is tomorrow')['private'])
if __name__=='__main__': unittest.main()

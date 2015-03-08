from unittest import TestCase

from libZoneTransit import Removal
from libZoneTransit import Addition
from libZoneTransit import File
from pdb import set_trace as dbg

class TestSuppression(TestCase):
  def setUp(self):
    self.file = File("test")
    self.removal = Removal(2, 2)

  def tearDown(self):
    pass

  def test_getPosition(self):
    self.assertEqual(self.removal.position, 2)

  def test_getSize(self):
    self.assertEqual(self.removal.size, 2)

  def test_apply(self):
    self.removal.apply(self.file)
    self.assertEqual(self.file.content, "te")
    
  def test_update(self):
    modification = Addition(0,5,"allo ")
    self.removal.update(modification)
    self.assertEqual(self.removal.position, 7)
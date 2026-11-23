"""Regressionen fuer 0.21.1; im lpdev-Container ohne echte Schaltbefehle ausfuehren."""
import asyncio
import json
import sys
import time
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, '/app/bin')
import webvisu as w


class Prerelease(unittest.TestCase):
    def setUp(self):
        self.a = w.App.__new__(w.App)
        self.a.controls = {}
        self.a.states = {}
        self.a.rooms = {}
        self.a.sperre_state = {}
        self.a.prognose_cache = {}
        self.a.prognose_pending = set()
        self.a._dirty = False

    def control(self, uid, typ, **values):
        c = {'name': 'Test', 'uuidAction': uid, 'type': typ, 'states': {k: uid + k for k in values}}
        self.a.controls[uid] = c
        self.a.states.update({uid + k: v for k, v in values.items()})
        return c

    def test_alarm_timezone_and_invalid(self):
        c = self.control('a', 'AlarmClock', nextEntryTime=100000)
        with patch.object(w, '_MS_OFF', 7200), patch.object(w, '_container_off', return_value=0):
            self.assertTrue(self.a._alarm_next_text(c).endswith('05:46'))
        self.a.states['anextEntryTime'] = float('inf')
        self.assertEqual(self.a._alarm_next_text(c), '')

    def test_locked_direct_and_secured_commands(self):
        u = '12345678-1234-1234-1234567890123456'
        self.a.client = object()
        self.a.sperre_state[u] = 'lock'
        self.a.states['lock'] = json.dumps({'locked': 2, 'reason': 'Wartung'})
        self.assertIn('Wartung', self.a._sperre_text(u))
        self.assertEqual(asyncio.run(self.a.command(u, 'on')), '423')
        self.assertEqual(asyncio.run(self.a._secured_command(u, 'on', '1234')), '423')
        self.assertIsNone(w._sperre_lesen('{bad'))
        self.assertIsNone(w._sperre_lesen('{"locked":0}'))

    def test_icons_and_order(self):
        self.assertIsNone(w._clean_icon({'src': 'google', 'name': 'home'}))
        self.assertIsNone(w._clean_icon({'src': 'custom', 'file': 'a.svg'}))
        self.assertEqual(w._nach_reihe(['b', 'a', 'c'], ['a', 'b']), ['a', 'b', 'c'])

    def test_climate_preserves_controls(self):
        c = self.control('cc', 'ClimateControllerUS', controls=json.dumps([{'uuid': 'a', 'demand': 0}, {'uuid': 'b', 'demand': 1}, {'uuid': []}]), demandHeat=1, mode=2)
        for uid in ('a', 'b'):
            rc = self.control(uid, 'IRoomControllerV2', tempActual=20, comfortTemperature=22)
            rc['room'] = uid
            self.a.rooms[uid] = {'name': uid}
        self.assertEqual(self.a._klima_anzahl(self.a._klima_einheiten(c)), '2 Räume')
        v = self.a._ccus_view(c, {'id': 'cc'})
        rows = next(b['rows'] for b in v['blocks'] if b['k'] == 'mlist')
        self.assertEqual([r['id'] for r in rows], ['b', 'a'])
        self.assertEqual(rows[0]['label'], 'Test (b)')
        self.assertEqual(rows[0]['btns'][1]['cmd']['cmd'], 'setComfortTemperature/22.5')
        self.assertEqual(rows[0]['nav']['id'], 'b')
        self.assertTrue(any(b['k'] == 'mseg' for b in v['blocks']))

    def test_real_tile_renderers(self):
        a = w.App({})
        a.controls = {'u': {'name': 'Unbekannt', 'type': 'UnknownFutureType'},
                      's': {'name': 'Preis', 'type': 'SpotPriceOptimizer', 'uuidAction': 's',
                            'details': {'format': '%.2f ct/kWh'}, 'states': {'current': 'price', 'active': 'active'}}}
        a.states = {'price': -2.5, 'active': 1}
        self.assertTrue(a._control_item_build('u')['unbekannt'])
        self.assertEqual(a._control_item_build('s')['nav']['id'], 's')
        self.assertIn('-2', a._control_item_build('s')['sublabel'])
        a.controls['s']['states'].update({'demand': 'demand', 'period': 'period'})
        a.states.update({'demand': 1, 'period': 4})
        now = int(time.time())
        a.strompreis_prognose = lambda *args: ([(now, now+3600, -2.5, True)], False)
        view = a._view_control('s')
        self.assertTrue(any(b['k'] == 'spotform' for b in view['blocks']))
        charts = [b for b in view['blocks'] if b['k'] == 'chart']
        self.assertEqual([b['kind'] for b in charts], ['analog', 'digital'])
        self.assertEqual(charts[0]['series'][0]['pts'][0][1], -2.5)

    def test_running_cycle_without_demand_state_can_cancel(self):
        c = self.control('s', 'SpotPriceOptimizer', cycleUntil=time.time()-w._EPOCH_2009+3600)
        self.a.strompreis_prognose = lambda *args: ([], False)
        form = next(b for b in self.a._spot_view('s', c, {})['blocks'] if b['k'] == 'spotform')
        self.assertTrue(form['cancel'])
        self.assertIsNone(form['tmpl'])

    def test_forecast_parser(self):
        self.assertIsNone(w._prognose_lesen('{}'))
        self.assertEqual(w._prognose_lesen('[{"s":2,"e":3,"v":-5,"planned":true},{"s":1,"e":0,"v":1},{"s":1,"e":2,"v":"NaN"}]'), [(2, 3, -5.0, True)])

    def test_forecast_cache_and_retry(self):
        c = self.control('s', 'SpotPriceOptimizer', forecastsTimestamp=1)
        async def run():
            self.a._ms_jdev = AsyncMock(return_value=('200', [{'s': 1, 'e': 2, 'v': -3}]))
            tasks = []
            self.a._spawn = lambda coro: tasks.append(asyncio.create_task(coro))
            self.assertEqual(self.a.strompreis_prognose('s', c), (None, True))
            self.a.strompreis_prognose('s', c)
            self.assertEqual(len(tasks), 1)
            await tasks[0]
            self.assertEqual(self.a.strompreis_prognose('s', c)[0][0][2], -3)
            self.a.states['sforecastsTimestamp'] = 2
            self.a._ms_jdev.return_value = ('500', None)
            self.a.strompreis_prognose('s', c)
            await tasks[-1]
            self.a.strompreis_prognose('s', c)
            self.assertEqual(len(tasks), 2)
            stand, _, _ = self.a.prognose_cache['s']
            self.a.prognose_cache['s'] = (stand, time.monotonic()-61, None)
            self.a.strompreis_prognose('s', c)
            await tasks[-1]
            self.assertEqual(len(tasks), 3)
        asyncio.run(run())

    def test_spot_form_and_logic_validation(self):
        c = self.control('s', 'SpotPriceOptimizer', current=-5, demand=0, period=4, minRuntime=0.25)
        self.a.strompreis_prognose = lambda *args: ([], False)
        v = self.a._spot_view('s', c, {'id': 's'})
        f = next(b for b in v['blocks'] if b['k'] == 'spotform')
        self.assertEqual(f['tmpl'], 'start/{bedarf}/{zeitraum}')
        self.assertEqual(f['fields'][0]['value'], 0.25)
        for cmd in ('start/0/4', 'start/nan/4', 'start/5/4', 'start/0.1/4', 'start/1/0'):
            self.assertFalse(self.a._spot_command_ok('s', cmd), cmd)
        self.assertTrue(self.a._spot_command_ok('s', 'start/0.25/4'))
        c['details'] = {'demandByLogic': True, 'periodByLogic': True}
        f = next(b for b in self.a._spot_view('s', c, {})['blocks'] if b['k'] == 'spotform')
        self.assertEqual(f['tmpl'], 'start/0/4')
        self.assertFalse(any('name' in b for b in f['fields']))
        self.assertTrue(self.a._spot_command_ok('s', 'start/0/4'))
        self.assertFalse(self.a._spot_command_ok('s', 'start/0/5'))


if __name__ == '__main__':
    unittest.main()

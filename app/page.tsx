'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from './supabase';

type ResultType = 'win' | 'draw' | 'lose' | null;

interface Game {
  id: string;
  name: string;
  group_name: string;
  team1_id: number;
  team2_id: number;
  team1_result: ResultType;
  team2_result: ResultType;
}

// نقط كل نتيجة
const POINTS: Record<'win' | 'draw' | 'lose', number> = {
  win: 50,
  draw: 30,
  lose: 25,
};

// تعريف الجروبات و أرقام الرهط بتاعتها
const GROUPS: { name: string; rahts: number[] }[] = [
  { name: 'Group 1', rahts: [1, 2, 3, 4, 5, 6] },
  { name: 'Group 2', rahts: [7, 8, 9, 10, 11, 12] },
];
const ALL_RAHTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [view, setView] = useState<'home' | 'groups' | 'detail' | 'board' | 'bonus'>('home');
  const [currentGroup, setCurrentGroup] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showGameModal, setShowGameModal] = useState(false);
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState(false);

  const [games, setGames] = useState<Game[]>([]);
  const [bonusPoints, setBonusPoints] = useState<Record<number, number>>({});
  const [bonusInputs, setBonusInputs] = useState<Record<number, string>>({});

  const [gameName, setGameName] = useState('');
  const [raht1, setRaht1] = useState<number>(1);
  const [raht2, setRaht2] = useState<number>(2);
  const [gameError, setGameError] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  // نتايج مؤقتة (لسه مش متحفوظة) لكل ماتش قبل ما تدوس Save
  const [pendingResults, setPendingResults] = useState<
    Record<string, { team1: ResultType; team2: ResultType }>
  >({});

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 1800);
  };

  const currentGroupRahts = GROUPS.find((g) => g.name === currentGroup)?.rahts ?? [1, 2, 3, 4, 5, 6];

  const fetchData = async () => {
    const { data: gamesData } = await supabase.from('matches').select('*');
    if (gamesData) setGames(gamesData);
    setPendingResults({});
  };

  const fetchBonus = async () => {
    const { data } = await supabase.from('bonus_points').select('*');
    if (data) {
      const map: Record<number, number> = {};
      data.forEach((row: { raht_id: number; points: number }) => {
        map[row.raht_id] = row.points;
      });
      setBonusPoints(map);
    }
  };

  useEffect(() => {
    fetchData();
    fetchBonus();
  }, []);

  // ده اللي بيخلي زرار Back بيرجعك بين صفحات الموقع بدل ما يطلعك بره خالص،
  // وبيخلي الـ Reload يفضل واقف في نفس الصفحة (لأن الحالة بقت متخزنة في الـ URL)
  useEffect(() => {
    const urlView = searchParams.get('view');
    const urlGroup = searchParams.get('group');
    const validViews = ['home', 'groups', 'detail', 'board', 'bonus'];
    setView(validViews.includes(urlView || '') ? (urlView as typeof view) : 'home');
    setCurrentGroup(urlGroup);
  }, [searchParams]);

  const navigate = (nextView: typeof view, group?: string | null) => {
    const params = new URLSearchParams();
    params.set('view', nextView);
    const finalGroup = group !== undefined ? group : currentGroup;
    if (finalGroup) params.set('group', finalGroup);
    router.push(`/?${params.toString()}`);
  };

  // كل ما تفتح مودال إضافة ماتش، خلي الاختيار الافتراضي أول رقمين في الجروب الحالي
  useEffect(() => {
    if (showGameModal) {
      setRaht1(currentGroupRahts[0]);
      setRaht2(currentGroupRahts[1]);
      setGameError(false);
    }
  }, [showGameModal]);

  const handleLogin = () => {
    if (password === 'mw') {
      setUnlocked(true);
      setShowLoginModal(false);
      setPassword('');
      setPwError(false);
      showToast('Edit mode unlocked');
    } else {
      setPwError(true);
    }
  };

  const handleAddGame = async () => {
    if (raht1 === raht2) {
      setGameError(true);
      return;
    }
    const nameFinal = gameName.trim() || `Match`;

    const payload = {
      name: nameFinal,
      group_name: currentGroup,
      team1_id: Number(raht1),
      team2_id: Number(raht2),
      team1_result: null,
      team2_result: null,
    };

    const { error } = await supabase.from('matches').insert([payload]);

    if (!error) {
      setShowGameModal(false);
      setGameName('');
      setGameError(false);
      fetchData();
      showToast('Match added successfully');
    } else {
      console.error('Supabase Error:', error);
      showToast('Error: Database constraint active');
    }
  };

  const handleDeleteGame = async (gameId: string) => {
    if (!unlocked || !confirm('Delete this match?')) return;
    await supabase.from('matches').delete().eq('id', gameId);
    fetchData();
    showToast('Match deleted');
  };

  // لما تدوس Win/Draw/Lose، بيحدد النتيجة المقابلة تلقائي للفريق التاني
  const selectResult = (gameId: string, team: 'team1' | 'team2', result: 'win' | 'draw' | 'lose') => {
    const game = games.find((g) => g.id === gameId);
    if (!game || game.team1_result) return; // مقفول لو الماتش خلص فعلا

    const current = pendingResults[gameId] ?? {
      team1: game.team1_result,
      team2: game.team2_result,
    };

    let next: { team1: ResultType; team2: ResultType };

    if (result === 'draw') {
      next = { team1: 'draw', team2: 'draw' };
    } else if (team === 'team1') {
      next = { team1: result, team2: result === 'win' ? 'lose' : 'win' };
    } else {
      next = { team2: result, team1: result === 'win' ? 'lose' : 'win' };
    }

    setPendingResults((prev) => ({ ...prev, [gameId]: next }));
  };

  const getCurrentResult = (game: Game, team: 'team1' | 'team2'): ResultType => {
    const pending = pendingResults[game.id];
    if (pending) return pending[team];
    return team === 'team1' ? game.team1_result : game.team2_result;
  };

  const isDirty = (gameId: string) => !!pendingResults[gameId];

  // بمجرد ما تعمل Save، النتيجة تتقفل نهائيا ومفيش رجوع فيها
  const handleSaveResult = async (gameId: string) => {
    if (!unlocked) return;
    const pending = pendingResults[gameId];
    if (!pending) return;
    if (!confirm('Save this result? It cannot be edited afterwards.')) return;

    const { error } = await supabase
      .from('matches')
      .update({ team1_result: pending.team1, team2_result: pending.team2 })
      .eq('id', gameId);

    if (!error) {
      fetchData();
      showToast('Result saved & locked');
    } else {
      console.error('Supabase Error:', error);
      showToast('Error saving result');
    }
  };

  const adjustBonus = async (rahtId: number, sign: 1 | -1) => {
    const raw = bonusInputs[rahtId];
    const amount = parseInt(raw || '0', 10);
    if (!amount) {
      showToast('Enter an amount first');
      return;
    }
    const current = bonusPoints[rahtId] || 0;
    const updated = current + sign * amount;

    const { error } = await supabase
      .from('bonus_points')
      .upsert({ raht_id: rahtId, points: updated }, { onConflict: 'raht_id' });

    if (!error) {
      setBonusInputs((prev) => ({ ...prev, [rahtId]: '' }));
      fetchBonus();
      showToast(`${sign > 0 ? '+' : '-'}${amount} pts to Raht ${rahtId}`);
    } else {
      console.error('Supabase Error:', error);
      showToast('Error updating bonus');
    }
  };

  const groupMatches = games.filter((g) => g.group_name === currentGroup);

  // ستاندنجز موحدة لل12 راهت (ماتشات + بونص)
  const computeStandings = () => {
    const totals: Record<number, number> = {};
    ALL_RAHTS.forEach((r) => (totals[r] = bonusPoints[r] || 0));
    games.forEach((g) => {
      if (g.team1_result) totals[g.team1_id] = (totals[g.team1_id] || 0) + POINTS[g.team1_result];
      if (g.team2_result) totals[g.team2_id] = (totals[g.team2_id] || 0) + POINTS[g.team2_result];
    });
    return Object.entries(totals)
      .map(([raht, pts]) => ({ raht: Number(raht), pts }))
      .sort((a, b) => b.pts - a.pts);
  };

  const resultBtnClass = (active: boolean, kind: 'win' | 'draw' | 'lose') => {
    const base = 'flex-1 py-2 rounded-lg text-[11px] font-bold border transition-all cursor-pointer';
    if (!active) return `${base} bg-[#070D1B] border-[#26314D] text-[#8B93A7] hover:border-[#8B93A7]`;
    if (kind === 'win') return `${base} bg-[#2EC46D]/20 border-[#2EC46D] text-[#2EC46D]`;
    if (kind === 'lose') return `${base} bg-[#E63946]/20 border-[#E63946] text-[#E63946]`;
    return `${base} bg-[#F2C94C]/20 border-[#F2C94C] text-[#F2C94C]`;
  };

  const rankStyle = (i: number) => {
    if (i === 0) return {
      wrap: 'bg-gradient-to-r from-[#FFD700]/15 to-transparent border-[#FFD700]',
      rank: 'text-[#FFD700]',
      pts: 'text-[#FFD700]',
      medal: '🥇',
    };
    if (i === 1) return {
      wrap: 'bg-gradient-to-r from-[#C7CDD6]/15 to-transparent border-[#C7CDD6]',
      rank: 'text-[#C7CDD6]',
      pts: 'text-[#C7CDD6]',
      medal: '🥈',
    };
    if (i === 2) return {
      wrap: 'bg-gradient-to-r from-[#CD7F32]/15 to-transparent border-[#CD7F32]',
      rank: 'text-[#CD7F32]',
      pts: 'text-[#CD7F32]',
      medal: '🥉',
    };
    return {
      wrap: 'bg-[#070D1B] border-[#26314D]/50',
      rank: 'text-[#8B93A7]',
      pts: 'text-white',
      medal: '',
    };
  };

  const resultBadgeClass = (kind: ResultType) => {
    const base = 'px-2.5 py-1 rounded-lg text-[11px] font-bold border inline-block';
    if (kind === 'win') return `${base} bg-[#2EC46D]/20 border-[#2EC46D] text-[#2EC46D]`;
    if (kind === 'lose') return `${base} bg-[#E63946]/20 border-[#E63946] text-[#E63946]`;
    if (kind === 'draw') return `${base} bg-[#F2C94C]/20 border-[#F2C94C] text-[#F2C94C]`;
    return `${base} bg-[#1A2540] border-[#26314D] text-[#8B93A7]`;
  };

  return (
    <main
      className="min-h-screen bg-[#070D1B] text-[#F5F3EE] antialiased selection:bg-[#2EC46D] selection:text-[#06301A]"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* خطوط Google Fonts */}
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800;900&display=swap');
        .font-heading {
          font-family: 'Anton', 'Arial Narrow', sans-serif;
        }
      `}</style>

      {/* Topbar */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-[#1A2540] sticky top-0 z-20 bg-[#070D1B]/90 backdrop-blur-md">
        <button onClick={() => navigate('home', null)} className="flex items-center gap-3 bg-transparent border-none text-[#F5F3EE] cursor-pointer group">
          <div className="w-8 h-8 rounded-lg bg-[#131C30] border border-[#26314D] flex items-center justify-center group-hover:border-[#2EC46D] transition-colors">
            🏁
          </div>
          <span className="font-heading tracking-wider text-lg">READY STEADY GO</span>
        </button>
        <div className="flex items-center gap-4">
          <div className="flex gap-2 bg-[#131C30] p-1 rounded-full border border-[#26314D]">
            <button onClick={() => navigate('groups', null)} className={`px-5 py-1.5 rounded-full text-xs font-bold transition-all ${view === 'groups' ? 'bg-[#1A2540] text-white shadow-sm border border-[#26314D]' : 'bg-transparent text-[#8B93A7]'}`}>Groups</button>
            <button onClick={() => navigate('board', null)} className={`px-5 py-1.5 rounded-full text-xs font-bold transition-all ${view === 'board' ? 'bg-[#1A2540] text-white shadow-sm border border-[#26314D]' : 'bg-transparent text-[#8B93A7]'}`}>Standings</button>
            {unlocked && (
              <button onClick={() => navigate('bonus', null)} className={`px-5 py-1.5 rounded-full text-xs font-bold transition-all ${view === 'bonus' ? 'bg-[#1A2540] text-white shadow-sm border border-[#26314D]' : 'bg-transparent text-[#8B93A7]'}`}>Bonus</button>
            )}
          </div>
          <button onClick={() => {
            if (unlocked) { setUnlocked(false); if (view === 'bonus') navigate('board'); showToast('Edit mode exited'); }
            else { setShowLoginModal(true); }
          }} className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${unlocked ? 'border-[#2EC46D] text-[#2EC46D] bg-[#1A2540]/50' : 'border-[#26314D] bg-[#131C30] text-[#F5F3EE] hover:border-[#8B93A7]'}`}>
            {unlocked ? '🔓 Judge Mode' : '🔒 Judge Login'}
          </button>
        </div>
      </nav>

      {/* HOME VIEW */}
      {view === 'home' && (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] text-center p-6 gap-8">
          <div className="w-20 h-20 rounded-2xl bg-[#131C30] border border-[#26314D] flex items-center justify-center shadow-xl shadow-black/40">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#2EC46D]">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
              <polyline points="16 7 22 7 22 13"></polyline>
            </svg>
          </div>
          <div className="space-y-3">
            <h1 className="font-heading text-5xl md:text-7xl tracking-wider uppercase">
              READY STEADY <span className="text-[#2EC46D]">GO</span>
            </h1>
            <p className="text-[#8B93A7] text-xs md:text-sm tracking-[5px] uppercase font-semibold">SPORTS CAMP · SCOREBOARD</p>
          </div>
          <button onClick={() => navigate('groups', null)} className="bg-[#2EC46D] text-[#06301A] font-heading text-lg tracking-wide px-10 py-3.5 rounded-full shadow-[0_0_25px_rgba(46,196,109,0.3)] hover:scale-105 transition-all cursor-pointer">
            Start ⟶
          </button>
        </div>
      )}

      {/* GROUPS VIEW */}
      {view === 'groups' && (
        <div className="max-w-4xl mx-auto p-6 md:p-12">
          <div className="mb-8">
            <h1 className="font-heading text-3xl tracking-wide">Groups</h1>
            <p className="text-[#8B93A7] text-sm mt-1">Select a group to manage matches and results</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {GROUPS.map((g, idx) => {
              const gMatches = games.filter(gm => gm.group_name === g.name);
              return (
                <div key={idx} onClick={() => navigate('detail', g.name)} className="bg-[#131C30] border border-[#26314D] p-6 rounded-2xl cursor-pointer hover:border-[#2EC46D] hover:-translate-y-1 transition-all shadow-lg">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="font-heading text-2xl tracking-wide">{g.name}</h2>
                    <div className="w-3 h-3 rounded-full bg-[#2EC46D] shadow-[0_0_10px_2px_rgba(46,196,109,0.4)]"></div>
                  </div>
                  <div className="text-[#8B93A7] text-xs leading-relaxed mb-4 min-h-[35px]">
                    Raht {g.rahts[0]} to Raht {g.rahts[g.rahts.length - 1]} (Matches & Results)
                  </div>
                  <div className="text-[#2EC46D] text-xs font-bold tracking-wide">{gMatches.length} matches recorded</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* GROUP DETAIL VIEW */}
      {view === 'detail' && (
        <div className="max-w-4xl mx-auto p-6 md:p-12">
          <button onClick={() => navigate('groups', null)} className="text-[#8B93A7] font-semibold text-sm mb-6 bg-transparent border-none cursor-pointer hover:text-white flex items-center gap-2">
            ← Back to groups
          </button>
          <div className="mb-6 flex justify-between items-end">
            <div>
              <h1 className="font-heading text-3xl tracking-wide">{currentGroup}</h1>
              <p className="text-[#8B93A7] text-xs mt-1">
                Manage matches (Raht {currentGroupRahts[0]} to {currentGroupRahts[currentGroupRahts.length - 1]})
              </p>
            </div>
            {unlocked && (
              <button onClick={() => setShowGameModal(true)} className="bg-[#2EC46D] text-[#06301A] font-bold text-xs px-4 py-2 rounded-xl cursor-pointer shadow">
                + Add Match
              </button>
            )}
          </div>

          {!unlocked && (
            <div className="bg-[#131C30] border border-[#26314D] text-[#8B93A7] text-xs p-3.5 rounded-xl mb-6 flex items-center gap-2">
              🔒 Editing is locked — click "Judge Login" on top to modify results.
            </div>
          )}

          <div className="flex flex-col gap-4">
            {groupMatches.length === 0 ? (
              <div className="text-[#8B93A7] text-center py-16 text-sm bg-[#131C30]/50 border border-[#26314D] rounded-2xl">
                No matches added in this group yet.
              </div>
            ) : (
              groupMatches.map(m => {
                const isLocked = !!m.team1_result;
                const t1Result = getCurrentResult(m, 'team1');
                const t2Result = getCurrentResult(m, 'team2');
                return (
                  <div key={m.id} className="bg-[#131C30] border border-[#26314D] rounded-2xl p-5 shadow">
                    <div className="flex justify-between items-center mb-3">
                      <span className="font-bold text-xs uppercase tracking-wider text-[#8B93A7]">{m.name}</span>
                      <div className="flex items-center gap-3">
                        {isLocked && <span className="text-[10px] font-bold text-[#8B93A7]">🔒 Locked</span>}
                        {unlocked && (
                          <button onClick={() => handleDeleteGame(m.id)} className="text-[#8B93A7] hover:text-[#E63946] text-xs bg-transparent border-none cursor-pointer">Delete Match</button>
                        )}
                      </div>
                    </div>

                    {isLocked ? (
                      // نتيجة نهائية مقفولة - مفيش تعديل خالص
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-[#070D1B] p-3.5 rounded-xl border border-[#26314D]/50 flex items-center justify-between">
                          <span className="text-xs font-bold text-white">Raht {m.team1_id}</span>
                          <span className={resultBadgeClass(m.team1_result)}>
                            {m.team1_result?.toUpperCase()} · +{POINTS[m.team1_result as 'win' | 'draw' | 'lose']}
                          </span>
                        </div>
                        <div className="bg-[#070D1B] p-3.5 rounded-xl border border-[#26314D]/50 flex items-center justify-between">
                          <span className="text-xs font-bold text-white">Raht {m.team2_id}</span>
                          <span className={resultBadgeClass(m.team2_result)}>
                            {m.team2_result?.toUpperCase()} · +{POINTS[m.team2_result as 'win' | 'draw' | 'lose']}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          {/* Raht 1 */}
                          <div className="bg-[#070D1B] p-3.5 rounded-xl border border-[#26314D]/50">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-white">Raht {m.team1_id}</span>
                              {t1Result && (
                                <span className="text-[10px] font-bold text-[#8B93A7]">+{POINTS[t1Result]} pts</span>
                              )}
                            </div>
                            <div className="flex gap-1.5">
                              <button disabled={!unlocked} onClick={() => selectResult(m.id, 'team1', 'win')} className={resultBtnClass(t1Result === 'win', 'win')}>Win</button>
                              <button disabled={!unlocked} onClick={() => selectResult(m.id, 'team1', 'draw')} className={resultBtnClass(t1Result === 'draw', 'draw')}>Draw</button>
                              <button disabled={!unlocked} onClick={() => selectResult(m.id, 'team1', 'lose')} className={resultBtnClass(t1Result === 'lose', 'lose')}>Lose</button>
                            </div>
                          </div>

                          {/* Raht 2 */}
                          <div className="bg-[#070D1B] p-3.5 rounded-xl border border-[#26314D]/50">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-white">Raht {m.team2_id}</span>
                              {t2Result && (
                                <span className="text-[10px] font-bold text-[#8B93A7]">+{POINTS[t2Result]} pts</span>
                              )}
                            </div>
                            <div className="flex gap-1.5">
                              <button disabled={!unlocked} onClick={() => selectResult(m.id, 'team2', 'win')} className={resultBtnClass(t2Result === 'win', 'win')}>Win</button>
                              <button disabled={!unlocked} onClick={() => selectResult(m.id, 'team2', 'draw')} className={resultBtnClass(t2Result === 'draw', 'draw')}>Draw</button>
                              <button disabled={!unlocked} onClick={() => selectResult(m.id, 'team2', 'lose')} className={resultBtnClass(t2Result === 'lose', 'lose')}>Lose</button>
                            </div>
                          </div>
                        </div>

                        {unlocked && (
                          <button
                            onClick={() => handleSaveResult(m.id)}
                            disabled={!isDirty(m.id)}
                            className={`mt-4 w-full py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                              isDirty(m.id)
                                ? 'bg-[#2EC46D] text-[#06301A] border-none'
                                : 'bg-[#1A2540] text-[#8B93A7] border-[#26314D] cursor-not-allowed'
                            }`}
                          >
                            {isDirty(m.id) ? 'Save Result (locks permanently)' : 'Select a result to save'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* STANDINGS VIEW - موحدة لل12 راهت */}
      {view === 'board' && (
        <div className="max-w-2xl mx-auto p-6 md:p-12">
          <div className="mb-8">
            <h1 className="font-heading text-3xl tracking-wide">Standings</h1>
            <p className="text-[#8B93A7] text-sm mt-1">Overall standings — all 12 Rahts</p>
          </div>
          <div className="bg-[#131C30] border border-[#26314D] rounded-2xl p-5 shadow">
            <div className="flex flex-col gap-2">
              {computeStandings().map((s, i) => {
                const rs = rankStyle(i);
                return (
                  <div key={s.raht} className={`flex items-center justify-between px-4 py-3 rounded-xl border ${rs.wrap} ${i < 3 ? 'py-4' : ''}`}>
                    <div className="flex items-center gap-4">
                      <span className={`font-heading w-10 ${i < 3 ? 'text-2xl' : 'text-lg'} ${rs.rank}`}>
                        {rs.medal || `#${i + 1}`}
                      </span>
                      <span className={`font-bold ${i < 3 ? 'text-base text-white' : 'text-sm text-white'}`}>Raht {s.raht}</span>
                    </div>
                    <span className={`font-heading ${i < 3 ? 'text-xl' : 'text-lg'} ${rs.pts}`}>
                      {s.pts} <span className="text-[10px] text-[#8B93A7] font-sans font-bold">pts</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* BONUS VIEW - Judge Mode بس */}
      {view === 'bonus' && unlocked && (
        <div className="max-w-2xl mx-auto p-6 md:p-12">
          <div className="mb-8">
            <h1 className="font-heading text-3xl tracking-wide">Bonus Points</h1>
            <p className="text-[#8B93A7] text-sm mt-1">Add or remove bonus points for any Raht (1–12)</p>
          </div>
          <div className="flex flex-col gap-3">
            {ALL_RAHTS.map((r) => (
              <div key={r} className="bg-[#131C30] border border-[#26314D] rounded-2xl p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-white w-20">Raht {r}</span>
                  <span className="text-xs font-bold text-[#2EC46D]">{bonusPoints[r] || 0} pts</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="amount"
                    value={bonusInputs[r] || ''}
                    onChange={(e) => setBonusInputs((prev) => ({ ...prev, [r]: e.target.value }))}
                    className="w-24 bg-[#070D1B] text-white border border-[#26314D] rounded-lg p-2 text-center text-sm focus:outline-none focus:border-[#2EC46D]"
                  />
                  <button onClick={() => adjustBonus(r, 1)} className="bg-[#2EC46D]/20 border border-[#2EC46D] text-[#2EC46D] font-bold text-xs px-3 py-2 rounded-lg cursor-pointer">+ Add</button>
                  <button onClick={() => adjustBonus(r, -1)} className="bg-[#E63946]/20 border border-[#E63946] text-[#E63946] font-bold text-xs px-3 py-2 rounded-lg cursor-pointer">− Remove</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LOGIN MODAL */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-[#070D1B]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#131C30] border border-[#26314D] rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="font-heading text-xl mb-4">🔒 Judge Login</h3>
            <input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              className="w-full bg-[#070D1B] border border-[#26314D] text-white p-3 rounded-xl mb-3 text-sm focus:outline-none focus:border-[#2EC46D]"
            />
            {pwError && <p className="text-[#E63946] text-xs mb-3 font-semibold">Incorrect password</p>}
            <div className="flex gap-2">
              <button onClick={() => setShowLoginModal(false)} className="flex-1 bg-[#1A2540] text-[#8B93A7] border border-[#26314D] p-3 rounded-xl font-bold text-xs cursor-pointer">Cancel</button>
              <button onClick={handleLogin} className="flex-1 bg-[#2EC46D] text-[#06301A] p-3 rounded-xl font-bold text-xs border-none cursor-pointer">Login</button>
            </div>
          </div>
        </div>
      )}

      {/* NEW MATCH MODAL */}
      {showGameModal && (
        <div className="fixed inset-0 bg-[#070D1B]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#131C30] border border-[#26314D] rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="font-heading text-xl mb-4">New Match</h3>

            <label className="text-[11px] text-[#8B93A7] font-bold block mb-1">MATCH NAME (OPTIONAL)</label>
            <input
              type="text"
              placeholder="e.g. Football"
              value={gameName}
              onChange={(e) => setGameName(e.target.value)}
              className="w-full bg-[#070D1B] border border-[#26314D] text-white p-3 rounded-xl mb-3 text-sm focus:outline-none focus:border-[#2EC46D]"
            />

            <label className="text-[11px] text-[#8B93A7] font-bold block mb-1">RAHT</label>
            <select value={raht1} onChange={(e) => setRaht1(parseInt(e.target.value))} className="w-full bg-[#070D1B] text-white border border-[#26314D] p-3 rounded-xl mb-3 text-sm focus:outline-none">
              {currentGroupRahts.map(num => (
                <option key={num} value={num} className="bg-[#131C30] text-white">Raht {num}</option>
              ))}
            </select>

            <label className="text-[11px] text-[#8B93A7] font-bold block mb-1">RAHT</label>
            <select value={raht2} onChange={(e) => setRaht2(parseInt(e.target.value))} className="w-full bg-[#070D1B] text-white border border-[#26314D] p-3 rounded-xl mb-3 text-sm focus:outline-none">
              {currentGroupRahts.map(num => (
                <option key={num} value={num} className="bg-[#131C30] text-white">Raht {num}</option>
              ))}
            </select>

            {gameError && <p className="text-[#E63946] text-xs mb-3 font-semibold">Select two different Raht numbers</p>}

            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowGameModal(false)} className="flex-1 bg-[#1A2540] text-[#8B93A7] border border-[#26314D] p-3 rounded-xl font-bold text-xs cursor-pointer">Cancel</button>
              <button onClick={handleAddGame} className="flex-1 bg-[#2EC46D] text-[#06301A] p-3 rounded-xl font-bold text-xs border-none cursor-pointer">Add</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#131C30] border border-[#26314D] text-white px-6 py-3 rounded-full text-xs font-bold z-50 shadow-2xl">
          {toastMsg}
        </div>
      )}
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}
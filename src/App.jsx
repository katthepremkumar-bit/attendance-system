import React, { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Activity, AlertCircle, ArrowUpRight, BookOpen, CalendarDays, Check,
  CheckCircle2, ChevronDown, ClipboardCheck, GraduationCap, LayoutDashboard,
  LogOut, Menu, Search, ShieldCheck, Users, X
} from 'lucide-react';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const adminEmail = (import.meta.env.VITE_ADMIN_EMAIL || '').trim().toLowerCase();
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const demoSubjects = [
  { id: 'math', name: 'Mathematics', code: 'MA201', present: 42, total: 50, color: 'violet' },
  { id: 'physics', name: 'Engineering Physics', code: 'PH202', present: 38, total: 45, color: 'blue' },
  { id: 'cprog', name: 'C Programming', code: 'CS203', present: 46, total: 50, color: 'green' },
  { id: 'english', name: 'Technical English', code: 'EN204', present: 34, total: 40, color: 'orange' }
];
const pct = (present, total) => total ? Math.round((present / total) * 1000) / 10 : 0;
const initials = (s='Student') => s.split(/\s+/).map(x => x[0]).join('').slice(0,2).toUpperCase();

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState('');
  const [role, setRole] = useState('student');
  const [active, setActive] = useState('overview');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [subjects, setSubjects] = useState([]);
  const [roster, setRoster] = useState([]);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0,10));
  const [attendance, setAttendance] = useState({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [adminUsers, setAdminUsers] = useState([]);
  const [classes, setClasses] = useState([]);

  
useEffect(() => {
  if (!supabase) {
    setBooting(false);
    return;
  }

  let active = true;

  async function initializeAuth() {
    try {
      const { data, error } = await supabase.auth.getSession();

      if (error) throw error;

      if (active) {
        setSession(data?.session || null);
      }
    } catch (err) {
      if (active) {
        setError(err.message || "Unable to restore login session.");
      }
    } finally {
      if (active) {
        setBooting(false);
      }
    }
  }

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    if (active) {
      setSession(session);

      if (!session) {
        setProfile(null);
        setSubjects([]);
      }
    }
  });

  initializeAuth();

  return () => {
    active = false;
    subscription.unsubscribe();
  };
}, []);

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) { setProfile(null); setSubjects([]); }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    let cancelled = false;
    (async () => {
      const user = session.user;
      const { data, error: profileError } = await supabase.from('profiles')
        .select('id, full_name, email, role, student_id, class_id')
        .eq('id', user.id).maybeSingle();
      if (cancelled) return;
      if (profileError) { setError(profileError.message); return; }
      // A profile is created by the database trigger. Email matching only grants the
      // configured admin UI; actual authorization is enforced by database RLS.
      const effective = data || { id: user.id, email: user.email, full_name: user.user_metadata?.full_name || user.email, role: user.email?.toLowerCase() === adminEmail ? 'admin' : 'student' };
      if (user.email?.toLowerCase() === adminEmail && effective.role !== 'admin') {
        setNotice('Admin email recognized. Run the admin promotion SQL in README to enable admin database permissions.');
      }
      setProfile(effective);
      setRole(effective.role || 'student');
      await loadData(effective);
    })();
    return () => { cancelled = true; };
  }, [session]);

  async function loadData(p = profile) {
    if (!supabase || !p) return;
    setError('');
    const { data: subjectRows, error: sErr } = await supabase.from('subjects')
      .select('id, name, code, class_id, teacher_id').order('name');
    if (sErr) setError(sErr.message);
    setSubjects(subjectRows || []);
    if (p.role === 'teacher' || p.role === 'admin') {
      const { data: studentRows, error: stErr } = await supabase.from('students')
        .select('id, roll_number, class_id, profiles!students_profile_id_fkey(id, full_name, email)')
        .order('roll_number');
      if (!stErr) setRoster((studentRows || []).map(s => ({...s, full_name:s.profiles?.full_name || 'Student', email:s.profiles?.email || '', profile_id:s.profiles?.id })));
      else setError(stErr.message);
    }
    if (p.role === 'admin') {
      const { data: people, error: pErr } = await supabase.from('profiles').select('id, full_name, email, role').order('full_name');
      if (!pErr) setAdminUsers(people || []); else setError(pErr.message);
      const { data: classRows } = await supabase.from('classes').select('id, name, section, academic_year').order('name');
      setClasses(classRows || []);
    }
    if (p.role === 'student') {
      const { data: student } = await supabase.from('students').select('id').eq('profile_id', p.id).maybeSingle();
      if (student) {
        const { data: records, error: aErr } = await supabase.from('attendance')
          .select('id, subject_id, attendance_date, status, subjects(name, code)')
          .eq('student_id', student.id).order('attendance_date', { ascending:false });
        if (!aErr) {
          const grouped = {};
          (records || []).forEach(r => {
            const k = r.subject_id;
            grouped[k] ||= { id:k, name:r.subjects?.name || 'Subject', code:r.subjects?.code || '', present:0,total:0,records:[] };
            grouped[k].total++; if (r.status === 'present') grouped[k].present++;
            grouped[k].records.push(r);
          });
          setStudentStats(Object.values(grouped));
        } else setError(aErr.message);
      }
    }
  }

  const [studentStats, setStudentStats] = useState([]);
  const currentSubjects = useMemo(() => {
    if (role === 'student' && studentStats.length) return studentStats;
    return demoSubjects;
  }, [role, studentStats]);
  const totalPresent = currentSubjects.reduce((n,s)=>n+s.present,0);
  const totalClasses = currentSubjects.reduce((n,s)=>n+s.total,0);
  const overall = pct(totalPresent,totalClasses);


async function signIn() {
  setError('');

  if (!supabase) {
    setError('Supabase is not configured.');
    return;
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: 'https://attendance-system-szth.vercel.app/'
    }
  });

  if (error) setError(error.message);
}

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setProfile(null); setSession(null); setActive('overview');
  }
  async function loadRegister() {
    if (!selectedSubject || !selectedDate || !supabase) return;
    const subject = subjects.find(s => s.id === selectedSubject);
    const eligible = roster.filter(s => !subject?.class_id || s.class_id === subject.class_id);
    setAttendance(Object.fromEntries(eligible.map(s => [s.id,'present'])));
    const { data } = await supabase.from('attendance').select('student_id,status')
      .eq('subject_id',selectedSubject).eq('attendance_date',selectedDate);
    if (data?.length) setAttendance(prev => ({...prev,...Object.fromEntries(data.map(a=>[a.student_id,a.status]))}));
  }
  async function saveAttendance() {
    if (!supabase || !selectedSubject) return;
    setSaving(true); setError(''); setNotice('');
    const rows = roster.filter(s => attendance[s.id]).map(s => ({
      student_id:s.id, subject_id:selectedSubject, attendance_date:selectedDate,
      status:attendance[s.id], marked_by:profile.id
    }));
    const { error } = await supabase.from('attendance').upsert(rows,{onConflict:'student_id,subject_id,attendance_date'});
    setSaving(false);
    if (error) setError(error.message);
    else setNotice(`Attendance saved for ${rows.length} students.`);
  }
  async function changeRole(person, nextRole) {
    const { error } = await supabase.from('profiles').update({role:nextRole}).eq('id',person.id);
    if (error) setError(error.message);
    else { setNotice(`Updated ${person.email} to ${nextRole}.`); loadData(); }
  }

  if (booting) return <div className="loading"><div className="spinner"/>Loading Attendly…</div>;
  if (!session) return <LoginScreen onLogin={signIn} error={error} configured={!!supabase} />;

  const nav = role === 'student'
    ? [{id:'overview',label:'Overview',icon:LayoutDashboard},{id:'subjects',label:'My subjects',icon:BookOpen},{id:'history',label:'Attendance history',icon:CalendarDays}]
    : role === 'teacher'
    ? [{id:'overview',label:'Overview',icon:LayoutDashboard},{id:'mark',label:'Mark attendance',icon:ClipboardCheck},{id:'reports',label:'Class reports',icon:Activity}]
    : [{id:'overview',label:'Overview',icon:LayoutDashboard},{id:'users',label:'Manage users',icon:Users},{id:'subjects',label:'Subjects & classes',icon:BookOpen}];

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu?'open':''}`}>
      <div className="brand"><div className="brand-icon"><GraduationCap size={23}/></div><div><b>Attendly</b><span>ATTENDANCE PORTAL</span></div><button className="mobile-close" onClick={()=>setMobileMenu(false)}><X/></button></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{nav.map(item=><button key={item.id} className={`nav-item ${active===item.id?'active':''}`} onClick={()=>{setActive(item.id);setMobileMenu(false)}}><item.icon size={18}/><span>{item.label}</span>{active===item.id&&<span className="nav-dot"/>}</button>)}</nav>
      {role==='admin'&&<div className="admin-note"><ShieldCheck size={17}/><div><b>Admin access</b><span>Manage the campus</span></div></div>}
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><ShieldCheck size={18}/></div><b>Your data, protected</b><p>Access is controlled by your account permissions.</p></div><button className="profile-row" onClick={signOut}><div className="avatar">{initials(profile?.full_name||session.user.email)}</div><div className="profile-meta"><b>{profile?.full_name||'Campus user'}</b><span>{session.user.email}</span></div><LogOut size={17}/></button></div>
    </aside>
    {mobileMenu&&<button className="scrim" onClick={()=>setMobileMenu(false)} aria-label="Close menu"/>}
    <main className="main">
      <header className="topbar"><button className="menu-button" onClick={()=>setMobileMenu(true)}><Menu/></button><div className="breadcrumb">Workspace <span>/</span> <b>{nav.find(n=>n.id===active)?.label||'Overview'}</b></div><div className="top-actions"><span className="role-chip"><span/> {role} portal</span><div className="avatar small">{initials(profile?.full_name||session.user.email)}</div></div></header>
      <div className="page">
        <div className="welcome-row"><div><div className="eyebrow">{new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div><h1>{greeting(active,role)}</h1><p>{subtitle(active,role)}</p></div><div className="welcome-actions">{role==='teacher'&&<button className="btn-primary" onClick={()=>setActive('mark')}><ClipboardCheck size={17}/> Take attendance</button>}{role==='admin'&&<button className="btn-primary" onClick={()=>setActive('users')}><Users size={17}/> Manage users</button>}</div></div>
        {error&&<div className="alert error"><AlertCircle size={18}/><span>{error}</span><button onClick={()=>setError('')}><X size={16}/></button></div>}
        {notice&&<div className="alert success"><CheckCircle2 size={18}/><span>{notice}</span><button onClick={()=>setNotice('')}><X size={16}/></button></div>}
        {active==='overview'&&<Overview role={role} profile={profile} subjects={currentSubjects} overall={overall} totalPresent={totalPresent} totalClasses={totalClasses} users={adminUsers} roster={roster} onNavigate={setActive}/>}
        {active==='subjects'&&role==='student'&&<Subjects subjects={currentSubjects}/>}
        {active==='history'&&<History stats={studentStats}/>}
        {active==='mark'&&role==='teacher'&&<div className="panel"><div className="panel-head"><div><h2>Take attendance</h2><p>Choose the class session, then mark each student.</p></div><span className="soft-badge">Teacher workspace</span></div><div className="filters"><label>Subject<select value={selectedSubject} onChange={e=>setSelectedSubject(e.target.value)}><option value="">Select subject</option>{subjects.map(s=><option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</select></label><label>Session date<input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)}/></label><button className="btn-secondary" onClick={loadRegister}>Load roster</button></div><div className="table-wrap"><table><thead><tr><th>Student</th><th>Roll number</th><th>Attendance status</th></tr></thead><tbody>{roster.map(s=><tr key={s.id}><td><div className="student-cell"><div className="avatar">{initials(s.full_name)}</div><div><b>{s.full_name}</b><span>{s.email}</span></div></div></td><td>{s.roll_number}</td><td><div className="attendance-toggle"><button className={attendance[s.id]==='present'?'chosen present':''} onClick={()=>setAttendance(a=>({...a,[s.id]:'present'}))}><Check size={15}/> Present</button><button className={attendance[s.id]==='absent'?'chosen absent':''} onClick={()=>setAttendance(a=>({...a,[s.id]:'absent'}))}><X size={15}/> Absent</button></div></td></tr>)}</tbody></table>{!roster.length&&<Empty text="No students found. Add student records and assign a class first."/>}</div><div className="panel-footer"><span>{Object.keys(attendance).length} students in register</span><button className="btn-primary" disabled={saving||!selectedSubject||!Object.keys(attendance).length} onClick={saveAttendance}>{saving?'Saving…':'Save attendance'}</button></div></div>}
        {active==='reports'&&role==='teacher'&&<Subjects subjects={subjects.map(s=>({...s,present:0,total:0}))} emptyLabel="Attendance summaries will appear after attendance records are entered."/>}
        {active==='users'&&role==='admin'&&<div className="panel"><div className="panel-head"><div><h2>People & permissions</h2><p>Review accounts and set their portal roles.</p></div><span className="soft-badge">{adminUsers.length} accounts</span></div><div className="search-box"><Search size={17}/><input placeholder="Search by name or email…" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Change role</th></tr></thead><tbody>{adminUsers.filter(u=>`${u.full_name} ${u.email}`.toLowerCase().includes(search.toLowerCase())).map(u=><tr key={u.id}><td><div className="student-cell"><div className="avatar">{initials(u.full_name||u.email)}</div><b>{u.full_name||'Unnamed user'}</b></div></td><td>{u.email}</td><td><span className={`role-label ${u.role}`}>{u.role}</span></td><td><select value={u.role} onChange={e=>changeRole(u,e.target.value)} disabled={u.email?.toLowerCase()===adminEmail}><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select></td></tr>)}</tbody></table></div><div className="panel-footer"><span>Use role changes carefully; database RLS enforces permissions.</span></div></div>}
        {active==='subjects'&&role==='admin'&&<div className="panel"><div className="panel-head"><div><h2>Subjects & classes</h2><p>Current subjects and class groups configured in Supabase.</p></div></div><div className="table-wrap"><table><thead><tr><th>Subject</th><th>Code</th><th>Class ID</th><th>Assigned teacher ID</th></tr></thead><tbody>{subjects.map(s=><tr key={s.id}><td>{s.name}</td><td>{s.code}</td><td>{s.class_id||'—'}</td><td>{s.teacher_id||'—'}</td></tr>)}</tbody></table>{!subjects.length&&<Empty text="No subjects yet. Add subjects in the Supabase subjects table."/>}</div></div>}
        <footer className="footer"><span>© {new Date().getFullYear()} Attendly</span><span><ShieldCheck size={14}/> Role-based access enabled</span></footer>
      </div>
    </main>
  </div>;
}

function greeting(active,role) {
  if (active==='mark') return 'Take attendance';
  if (active==='users') return 'People & permissions';
  if (active==='subjects') return role==='admin'?'Subjects & classes':'Your subjects';
  if (active==='history') return 'Attendance history';
  if (role==='teacher') return 'Welcome to your classroom';
  if (role==='admin') return 'Campus overview';
  return 'Your learning at a glance';
}
function subtitle(active,role) {
  if (active==='mark') return 'Keep your class register accurate and up to date.';
  if (active==='users') return 'Manage student, teacher, and administrator access.';
  if (active==='history') return 'Review attendance records by date and subject.';
  if (role==='teacher') return 'Manage class attendance and monitor student participation.';
  if (role==='admin') return 'Monitor attendance and manage portal access across your campus.';
  return 'Track your attendance and stay on top of every subject.';
}

function LoginScreen({onLogin,error,configured}) {
  return <div className="login-layout"><div className="login-art"><div className="art-brand"><div className="brand-icon"><GraduationCap size={23}/></div><b>Attendly</b></div><div className="art-content"><div className="art-pill"><span/> CAMPUS ATTENDANCE, SIMPLIFIED</div><h1>Every class<br/>counts.</h1><p>A clearer view of attendance for students, teachers, and campus administrators.</p><div className="art-stat-row"><div className="art-stat"><b>01</b><span>One connected campus</span></div><div className="art-stat"><b>03</b><span>Purpose-built portals</span></div></div></div><div className="art-bottom">Designed for better attendance visibility.</div></div><div className="login-side"><div className="login-card"><div className="login-symbol"><GraduationCap size={27}/></div><div className="eyebrow">WELCOME TO ATTENDLY</div><h2>Sign in to your portal</h2><p>Use your college Google account to securely access your attendance workspace.</p><button className="google-btn" onClick={onLogin}><GoogleMark/> Continue with Google <ArrowUpRight size={17}/></button>{error&&<div className="alert error login-error"><AlertCircle size={17}/><span>{error}</span></div>}{!configured&&<div className="setup-warning"><AlertCircle size={16}/><span>Setup needed: copy <code>.env.example</code> to <code>.env</code> and add your Supabase project URL and publishable key.</span></div>}<div className="login-divider"><span/>SECURE ACCESS<span/></div><div className="login-benefits"><div><ShieldCheck size={17}/><span>Protected by Supabase authentication</span></div><div><Users size={17}/><span>Separate access for each role</span></div></div><p className="login-foot">New accounts start as students. Admins can assign teacher roles after signing in.</p></div></div></div>
}
function GoogleMark(){return <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.76 7.18l7.73 6C44.42 37.97 46.98 31.8 46.98 24.55z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.2A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>}
function Overview({role,profile,subjects,overall,totalPresent,totalClasses,users,roster,onNavigate}) {
  const stats = role==='admin'
    ? [{label:'Registered users',value:users.length,sub:'Across all roles',icon:Users,color:'violet'},{label:'Students',value:users.filter(u=>u.role==='student').length,sub:'Student accounts',icon:GraduationCap,color:'blue'},{label:'Teachers',value:users.filter(u=>u.role==='teacher').length,sub:'Teaching accounts',icon:BookOpen,color:'green'},{label:'Subjects',value:subjects.length,sub:'Configured subjects',icon:ClipboardCheck,color:'orange'}]
    : role==='teacher'
    ? [{label:'Students in roster',value:roster.length,sub:'Visible to your account',icon:Users,color:'violet'},{label:'Assigned subjects',value:subjects.length,sub:'Available subjects',icon:BookOpen,color:'blue'},{label:'Sessions today',value:'—',sub:'Connect timetable to track',icon:CalendarDays,color:'green'},{label:'Attendance records',value:'—',sub:'See class reports',icon:Activity,color:'orange'}]
    : [{label:'Overall attendance',value:`${overall}%`,sub:'Across recorded subjects',icon:Activity,color:'violet'},{label:'Classes attended',value:totalPresent,sub:'Marked present',icon:CheckCircle2,color:'green'},{label:'Classes held',value:totalClasses,sub:'Recorded sessions',icon:CalendarDays,color:'blue'},{label:'Subjects tracked',value:subjects.length,sub:'With attendance records',icon:BookOpen,color:'orange'}];
  const below = role==='student' ? subjects.filter(s=>pct(s.present,s.total)<75) : [];
  return <><div className="stats-grid">{stats.map(s=><div className="stat-card" key={s.label}><div className={`stat-icon ${s.color}`}><s.icon size={20}/></div><div className="stat-label">{s.label}</div><div className="stat-value">{s.value}</div><div className="stat-sub">{s.sub}</div></div>)}</div>
    <div className="content-grid"><section className="panel subjects-panel"><div className="panel-head"><div><h2>{role==='admin'?'Portal activity':role==='teacher'?'Your subjects':'Subject attendance'}</h2><p>{role==='student'?'A subject-by-subject look at your progress.':'Summary of the data available to your account.'}</p></div><button className="text-button" onClick={()=>onNavigate(role==='admin'?'users':role==='teacher'?'mark':'subjects')}>{role==='teacher'?'Take attendance':'View all'} <ArrowUpRight size={15}/></button></div>{role==='admin'?<div className="activity-list"><div className="activity-item"><div className="activity-icon violet"><Users size={18}/></div><div><b>Account management</b><span>Review new accounts and assign roles.</span></div><button onClick={()=>onNavigate('users')}>Open <ArrowUpRight size={14}/></button></div><div className="activity-item"><div className="activity-icon blue"><BookOpen size={18}/></div><div><b>Academic setup</b><span>Check classes and subject assignments.</span></div><button onClick={()=>onNavigate('subjects')}>Open <ArrowUpRight size={14}/></button></div></div>:<div className="subject-list">{subjects.slice(0,5).map(s=>{const p=pct(s.present,s.total);return <div className="subject-row" key={s.id}><div className={`subject-icon ${s.color||'violet'}`}><BookOpen size={18}/></div><div className="subject-main"><div className="subject-name"><b>{s.name}</b><span>{s.code||'SUBJECT'}</span></div><div className="progress-track"><div className={`progress-fill ${p<75?'warning':''}`} style={{width:`${p}%`}}/></div><div className="subject-meta">{s.present} of {s.total} classes attended</div></div><div className={`percent ${p<75?'warning-text':''}`}>{p}%</div></div>})}{!subjects.length&&<Empty text="No subject data is available yet."/>}</div>}</section>
    <aside className="right-column"><div className="attendance-card"><div className="attendance-card-top"><div><span className="small-label">{role==='student'?'ATTENDANCE STATUS':'WORKSPACE STATUS'}</span><h3>{role==='student'?(overall>=75?'Looking good': 'Needs attention'):'You’re all set'}</h3></div><div className="status-orb"><Activity size={21}/></div></div>{role==='student'?<><div className="big-percent">{overall}<span>%</span></div><div className="progress-track large"><div className={`progress-fill ${overall<75?'warning':''}`} style={{width:`${overall}%`}}/></div><p>{overall>=75?'Keep up your consistent class participation.':'Check the subjects below and speak with your teacher if you need help.'}</p></>:<p>{role==='admin'?'Manage access and review campus-wide records from your admin tools.':'Select a subject and date to record class attendance.'}</p>}<div className="card-divider"/><div className="mini-stat"><span>{role==='student'?'Recorded classes':'Signed-in account'}</span><b>{role==='student'?totalClasses:(profile?.email||'—')}</b></div></div>{role==='student'&&<div className="tip-card"><div className="tip-head"><div className="tip-icon"><AlertCircle size={18}/></div><b>Attendance tip</b></div><p>Try to maintain at least 75% attendance in every subject. Your college's official requirement may differ.</p>{below.length>0&&<button onClick={()=>onNavigate('subjects')}>Review {below.length} subject{below.length>1?'s':''} <ArrowUpRight size={14}/></button>}</div>}</aside></div></>
}
function Subjects({subjects,emptyLabel='Your subject attendance will appear after your teachers record class sessions.'}) {
  return <div className="panel"><div className="panel-head"><div><h2>Subject-wise attendance</h2><p>See attendance totals and percentages for each subject.</p></div></div>{subjects.length?<div className="table-wrap"><table><thead><tr><th>Subject</th><th>Present</th><th>Classes held</th><th>Attendance</th><th>Status</th></tr></thead><tbody>{subjects.map(s=>{const p=pct(s.present,s.total);return <tr key={s.id}><td><div className="subject-name"><b>{s.name}</b><span>{s.code||'SUBJECT'}</span></div></td><td>{s.present}</td><td>{s.total}</td><td><div className="table-progress"><div className="progress-track"><div className={`progress-fill ${p<75?'warning':''}`} style={{width:`${p}%`}}/></div><b>{p}%</b></div></td><td><span className={`status-pill ${p>=75?'ok':'low'}`}>{p>=75?'On track':'Needs attention'}</span></td></tr>})}</tbody></table></div>:<Empty text={emptyLabel}/>}</div>
}
function History({stats}) {
  const records=stats.flatMap(s=>s.records.map(r=>({...r,subject:s.name,code:s.code}))).sort((a,b)=>b.attendance_date.localeCompare(a.attendance_date));
  return <div className="panel"><div className="panel-head"><div><h2>Attendance history</h2><p>Previously recorded attendance sessions.</p></div><span className="soft-badge">{records.length} records</span></div>{records.length?<div className="table-wrap"><table><thead><tr><th>Date</th><th>Subject</th><th>Status</th></tr></thead><tbody>{records.map(r=><tr key={r.id}><td>{new Date(r.attendance_date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</td><td><div className="subject-name"><b>{r.subject}</b><span>{r.code}</span></div></td><td><span className={`status-pill ${r.status==='present'?'ok':'low'}`}>{r.status==='present'?'Present':'Absent'}</span></td></tr>)}</tbody></table></div>:<Empty text="No attendance records are available yet. Your history will appear when a teacher saves attendance."/>}</div>
}
function Empty({text}) { return <div className="empty-state"><div className="empty-icon"><ClipboardCheck size={22}/></div><b>Nothing to show yet</b><p>{text}</p></div> }

export default App;

"""Generate the review workbook from economy:model output; requires xlsxwriter (bundled Codex Python)."""
import json, math, sys
from pathlib import Path
import xlsxwriter
src=Path(sys.argv[1] if len(sys.argv)>1 else 'docs/economy/model.json')
out=Path(sys.argv[2] if len(sys.argv)>2 else 'docs/economy/Blocky-League-Economy.xlsx')
m=json.loads(src.read_text()); out.parent.mkdir(parents=True,exist_ok=True)
w=xlsxwriter.Workbook(out); w.set_calc_mode('auto')
w.set_properties({'title':'Blocky League economy review','subject':'Time, coins, gems and transparent store value','author':'Blocky League','comments':'Planning scenarios based on source rules. Not player telemetry.'})
F={
 'title':w.add_format({'bold':True,'font_size':22,'font_color':'#172434'}),
 'head':w.add_format({'bold':True,'bg_color':'#172434','font_color':'white','text_wrap':True,'valign':'vcenter'}),
 'text':w.add_format({'text_wrap':True,'valign':'top'}),
 'int':w.add_format({'num_format':'#,##0'}),
 'dec':w.add_format({'num_format':'0.0'}),
 'pct':w.add_format({'num_format':'0%'}),
 'money':w.add_format({'num_format':'"US$"0.00'}),
 'input':w.add_format({'font_color':'#1768AE','bg_color':'#E9F3FF','num_format':'0.0'}),
 'inputpct':w.add_format({'font_color':'#1768AE','bg_color':'#E9F3FF','num_format':'0%'}),
 'calc':w.add_format({'bg_color':'#E4F5EC','num_format':'0.0'}),
 'note':w.add_format({'font_color':'#576170','text_wrap':True,'valign':'top'}),
}
def sheet(name,headers,widths):
 s=w.add_worksheet(name); s.freeze_panes(1,1); s.set_row(0,32)
 for c,(h,width) in enumerate(zip(headers,widths)): s.write(0,c,h,F['head']); s.set_column(c,c,width)
 return s
r=w.add_worksheet('Start Here'); r.set_column('A:A',3); r.set_column('B:B',35); r.set_column('C:H',14); r.merge_range('B2:H3','BLOCKY LEAGUE · ECONOMY REVIEW',F['title'])
r.merge_range('B5:H6','The game has a viable free route. Coins develop the club and, from economy v8 (16 October 2026, further down this sheet), its players; gems buy guaranteed identities, permanent passes and optional shortcuts.',F['text'])
r.merge_range('B8:H9','HOW TO USE: blue cells in Goals are editable. Green cells recalculate saving time. Source Outputs show exact seeded model results; they do not change when you edit a planning assumption.',F['text'])
r.merge_range('B11:H12','WHAT THIS IS: a repeatable planning model, not measured retention, conversion, profit or proof that the game feels fun. Currency totals are gross earnings before spending.',F['text'])
for i,note in enumerate(m['assumptions']):
 row=14+i*2; r.merge_range(row,1,row+1,7,note,F['note'])
# (Under the assumptions, however many there are: a fixed row collided with them once a new one was added.)
after=14+len(m['assumptions'])*2+1
r.merge_range(after,1,after+2,7,'Regenerate: npm run economy:model, then run scripts/economy-workbook.py with Python + xlsxwriter. Review after changes to rewards, match length, player progression or purchases. No monthly content update is required by the twelve permanent Journeys.',F['text'])
r.merge_range(after+4,1,after+6,7,'14 October 2026, coming back: the sheets Coming Back, Come Back Sources, Club Income and Portal show the welcome week, the play streak, the match of the day and club income, each profile before and after, and what a portal player (nothing for sale) can afford and when.',F['text'])
s=sheet('Source Outputs',['Profile','Day','Matches','Play minutes*','Gross coins','Gross gems','Tickets earned','Free packs available','Journeys completed'],[33,10,12,16,16,16,18,22,22]); row=1
for p in m['profiles']:
 for day in [1,7,30,60,90]:
  x=p['rows'][day-1]; s.write_row(row,0,[p['profile']['name'],day,x['matches'],x['minutes'],x['coins'],x['gems'],x['ticketsEarned'],x['freePacks'],x['completedJourneys']]); row+=1
s.autofilter(0,0,row-1,8)
s.write(row+2,0,'*Includes assumed scene/menu time; excludes ad duration.',F['note'])
s=sheet('Sources',['Profile','Currency','Source','90-day amount','Source scope'],[33,12,22,19,57]); row=1
for p in m['profiles']:
 for cur,key in [('Coins','coinSources'),('Gems','gemSources')]:
  for source,amount in p[key].items():
   s.write_row(row,0,[p['profile']['name'],cur,source,amount,'Shared play loops; career and card sales shown separately']); row+=1
s.autofilter(0,0,row-1,4)
s=sheet('Goals',['Profile','Goal','Currency','Cost','Starting balance','Gross/day (days31–90)','Share saved for goal','Planning days','Planning matches','Matches / week','Exact no-spend model day'],[32,31,11,14,17,24,22,18,20,18,27]); row=1
for p in m['profiles']:
 profile=p['profile']; a=p['rows'][29]; b=p['rows'][89]
 goals=[('Main stand','coins',800),('Youth academy','coins',3000),('Legendary cosmetic','coins',7500),('Whole ground','coins',35600),('Local scouting network','gems',200),('Signature / permanent pass','gems',600),('All scouting networks','gems',1700)]
 for name,cur,cost in goals:
  start=500 if cur=='coins' else 50; rate=(b[cur]-a[cur])/60; share=.4 if cur=='coins' else .75
  days=math.ceil(max(0,cost-start)/(rate*share)) if rate else 0; mpw=len(profile['weekdays'])*profile['matches']
  exact=next((x['day'] for x in p['rows'] if x[cur]>=cost),'Beyond 90 days')
  s.write_row(row,0,[profile['name'],name,cur]); s.write_number(row,3,cost,F['input']); s.write_number(row,4,start,F['input']); s.write_number(row,5,rate,F['input']); s.write_number(row,6,share,F['inputpct'])
  n=row+1; s.write_formula(row,7,f'=IF(F{n}*G{n}>0,ROUNDUP(MAX(0,D{n}-E{n})/(F{n}*G{n}),0),0)',F['calc'],days); s.write_formula(row,8,f'=ROUNDUP(H{n}*J{n}/7,0)',F['calc'],math.ceil(days*mpw/7)); s.write_number(row,9,mpw,F['input']); s.write(row,10,exact); row+=1
s.data_validation(1,6,row-1,6,{'validate':'decimal','criteria':'between','minimum':.01,'maximum':1})
s.data_validation(1,5,row-1,5,{'validate':'decimal','criteria':'>','value':0})
s.autofilter(0,0,row-1,10)
s.write(row+2,0,'Each goal is independent. Add build time (1–2 league matchdays) and compete with other spending. Planning days use a steady-rate approximation, not the exact curve.',F['note']); s.set_row(row+2,42)
s=sheet('Sinks',['Category','ID','Item','Coins','Gems','Build matchdays'],[19,29,35,14,14,19]);
for row,x in enumerate(m['sinks'],1): s.write_row(row,0,[x['category'],x['id'],x['name'],x['coins'],x['gems'],x['waitMatches']])
s.autofilter(0,0,len(m['sinks']),5)
s=sheet('Store Value',['Product','Type','Reference US price','Normal gems','First-buy gems','Coins','Normal gems / US$','First gems / US$'],[24,20,23,17,18,14,23,23])
for row,x in enumerate(m['store'],1):
 s.write_row(row,0,[x['id'],x['kind']]); s.write_number(row,2,x['usd'],F['money']); s.write_row(row,3,[x['gems'],x['firstGems'],x['coins']]); n=row+1
 s.write_formula(row,6,f'=D{n}/C{n}',F['calc'],x['gems']/x['usd']); s.write_formula(row,7,f'=E{n}/C{n}',F['calc'],x['firstGems']/x['usd'])
s.merge_range('A14:H16','Reference USD pricing is not a localized StoreKit quote. The actual store price wins. First-buy bonuses are one-time per pack. Do not claim a blanket best value or fixed percentage saving across currencies. Native IAP product setup and real purchase validation remain release prerequisites.',F['note'])
s.merge_range('A18:H19','Permanent pass: 600 gems or reference US$3.99, grants 5,560 coins + 150 gems + 6 items after all tiers. First 660-gem pack costs US$2.99, so the direct cash pass is not always cheapest. Signature collection gives all six items immediately, with no currency rewards.',F['text'])
s=sheet('Career and Cards',['Division / squad OVR','Stadium / kind','Two-goal win / mean resale','20-goal win / min resale','Max resale','Notes'],[25,21,30,30,18,55]); row=1
for x in m['careerFees']:
 s.write_row(row,0,[x['division'],x['stadium'],x['twoGoalWin'],x['twentyGoalWin'],'','Base fee before streak, club boosts, side rewards and spending']); row+=1
for x in m['scoutResale']:
 s.write_row(row,0,[x['ovr'],'Scout card',x['mean'],x['min'],x['max'],f"1,000 draws. Previous uncapped mean: {x['previousMean']:.1f}. Sell or use for squad, never both."]); row+=1
for x in m['commercial']:
 s.write_row(row,0,[f"Commercial level {x['level']}", f"Fee {x['fee']}", x['netPerMatch'], f"Wage {x['wage']}", f"Home +{x['home']}", 'Net per league match before sponsor, assuming half home.']); row+=1
s.merge_range(row+2,0,row+4,5,'Career cashflow also includes sponsor and commercial income, cup/season/board prizes and player sales; staff wages, renewals, training and purchases consume it. These variable choices are not included in the shared-loop totals. Full care is taken to keep prize multipliers separate.',F['note'])
s=sheet('90 Day Ledger',['Profile','Day','Date','Matches','Minutes','Coins','Gems','Tickets','Free packs','Journeys'],[33,10,14,12,14,16,14,12,15,14]); row=1
for p in m['profiles']:
 for x in p['rows']:
  s.write_row(row,0,[p['profile']['name'],x['day'],x['date'],x['matches'],x['minutes'],x['coins'],x['gems'],x['ticketsEarned'],x['freePacks'],x['completedJourneys']]); row+=1
s.autofilter(0,0,row-1,9)
chart=w.add_chart({'type':'line'})
for i,p in enumerate(m['profiles']):
 first=1+i*90; last=first+89
 chart.add_series({'name':p['profile']['name'],'categories':['90 Day Ledger',first,1,last,1],'values':['90 Day Ledger',first,6,last,6]})
chart.set_title({'name':'Earned gems before spending'}); chart.set_x_axis({'name':'Calendar day'}); chart.set_y_axis({'name':'Gems','min':0}); chart.set_legend({'position':'bottom'}); chart.set_size({'width':790,'height':410})
r.insert_chart('J5',chart)
check=sheet('Checks and Limits',['Item','Result / limit'],[38,112]); notes=[
 ('Source reconciliation','Every model coin/gem source sums to its final total; deterministic seeds are repeatable.'),
 ('Modeled uncertainty','20 seeds per profile. These are scenario sensitivity ranges, not confidence intervals.'),
 ('Referral promise','1,000 coins + 50 gems for each qualifying side. Up to20 invited friends plus one welcome receipt; unchanged.'),
 ('Offline trust','Local saves and device dates remain client-authoritative. Rewind protection closes simple reset farming; it is not server anti-cheat.'),
 ('Date correction','A claim made with the phone clock in the future stays unavailable until its recorded day passes. A trusted-time recovery flow is not included.'),
 ('Native payments','Production IAP products/ad units and end-to-end purchases must be configured and tested before public monetization.'),
 ('Evergreen limits','The12 Journeys are permanent, finite content. Career play can continue; a finite shipped catalogue cannot guarantee endless demand or revenue.'),
 ('Visual QA','This workbook and code/CLI checks do not constitute rendered or device visual testing.'),
]
for row,(a,b) in enumerate(notes,1): check.write(row,0,a,F['text']); check.write(row,1,b,F['text']); check.set_row(row,43)
for p in m['ranges']: check.write_row(len(notes)+2+m['ranges'].index(p),0,[p['id'],f"90-day range: {p['coinsMin']:,}–{p['coinsMax']:,} coins; {p['gemsMin']:,}–{p['gemsMax']:,} gems"])

# ---------------------------------------------------------------- coming back (14 October 2026)
# The welcome week, the play streak, the match of the day, club income and the portal profiles: model.json 'comeback'.
# Absent from an older model.json, in which case the workbook is the one above and nothing more.
ratio=lambda a,b: a/b if b>0 else 0
cb=m.get('comeback')
if cb:
 K=cb['constants']; day_txt=lambda d: d if d is not None else f"Beyond {cb['horizon']} days"
 # --- before and after, every profile, at the day marks
 s=sheet('Coming Back',['Profile','Day','Coins before','Coins after','Coins change','Gems before','Gems after','Gems change','Looks handed over (coin value)','Ground level','Office coins an hour','Play streak day'],[33,8,15,15,14,14,14,14,30,14,22,18]); row=1
 for p in cb['beforeAfter']:
  for x in p['marks']:
   n=row+1
   s.write_row(row,0,[p['name'],x['day'],x['coinsBefore'],x['coinsAfter']]); s.write_formula(row,4,f'=IF(C{n}>0,D{n}/C{n}-1,0)',F['pct'],x['coinsAfter']/x['coinsBefore']-1)
   s.write_row(row,5,[x['gemsBefore'],x['gemsAfter']]); s.write_formula(row,7,f'=IF(F{n}>0,G{n}/F{n}-1,0)',F['pct'],x['gemsAfter']/x['gemsBefore']-1)
   s.write_row(row,8,[x['looks'],x['ground'],x['incomeRate'],x['streak']]); row+=1
 s.autofilter(0,0,row-1,11)
 s.merge_range(row+1,0,row+4,11,'Before: the economy of 6 October 2026 (the same seeded matches, the come-back features off). After: the welcome week, the play streak, the match of the day and club income on, claimed as the assumptions on Start Here say. Gross earning before any spending. Looks are items from the shop at their coin price: they are not coins and are never counted as coins.',F['note'])
 # --- the new sources: the rules as numbers, then what each profile got from them in 90 days
 s=sheet('Come Back Sources',['Welcome week, calendar day','Calendar coins','Calendar gems','Calendar tickets','Extra gems, first time','Extra tickets, first time','Look, first time','Look coin value (paid instead if owned)'],[30,16,15,17,22,24,24,36]); row=1
 for x in K['welcomeWeek']:
  it=x['item']; s.write_row(row,0,[f"Day {x['day']}",x['calendarCoins'],x['calendarGems'],x['calendarTickets'],x['gems'],x['tickets'],f"{it['name']} ({it['kind']})" if it else '',it['coins'] if it else 0]); row+=1
 s.write(row,0,'Week total',F['head']);
 WW=[[x['calendarCoins'],x['calendarGems'],x['calendarTickets'],x['gems'],x['tickets'],0,x['item']['coins'] if x['item'] else 0] for x in K['welcomeWeek']]
 for c in range(1,8):
  if c!=6: s.write_formula(row,c,f'=SUM({chr(65+c)}2:{chr(65+c)}{row})',F['calc'],sum(r[c-1] for r in WW))
 row+=3
 for c,h in enumerate(['Play streak day','Coins','Gems','Reserved look, once','Look coin value']): s.write(row,c,h,F['head'])
 row+=1
 for x in K['streak']:
  it=x['item']; s.write_row(row,0,[f"Day {x['day']}",x['coins'],x['gems'],f"{it['name']} ({it['kind']})" if it else '',it['coins'] if it else 0]); row+=1
 s.write(row,0,'One missed day a week is forgiven. A longer break halves the streak; nothing is zeroed.',F['note']); row+=3
 for c,h in enumerate(['Weekly, at the steady rate','Value']): s.write(row,c,h,F['head'])
 row+=1
 for label,val in [('Match of the day, coins a day',K['matchOfTheDay']['coins']),('Match of the day, gems a day',K['matchOfTheDay']['gems']),('Come-back gems a week',K['weeklyComebackGems']),('Come-back coins a week (match of the day and streak)',K['weeklyComebackCoins']),
   ('Loop gems a week, apps, with the daily ad',K['weeklyLoopGemsApp']),('Loop gems a week, apps, no ads',K['weeklyLoopGemsAppNoAds']),('Loop gems a week, portal, every offer',K['weeklyLoopGemsPortal']),('Tuned band for a week of loop gems','80 to 160')]:
  s.write(row,0,label); s.write(row,1,val); row+=1
 row+=2
 for c,h in enumerate(['Profile','Currency','Source','90 day amount','Share of the 90 day total']): s.write(row,c,h,F['head'])
 row+=1; first=row
 for p in cb['beforeAfter']:
  for cur,key,names in [('Coins','coinSources',['streak','matchOfDay','clubIncome']),('Gems','gemSources',['welcomeWeek','streak','matchOfDay'])]:
   total=sum(p[key].values())
   for name in names:
    s.write_row(row,0,[p['name'],cur,name,p[key][name]]); s.write_number(row,4,p[key][name]/total if total else 0,F['pct']); row+=1
 # --- club income: the rate as editable inputs, then the model's check against each profile's day
 s=sheet('Club Income',['Ground level','Ticket office, coins an hour','Club shop (megastore)','Commercial manager %','Atmosphere %','Coins an hour','Full office (cap hours x rate)'],[26,28,24,24,16,18,30]); I=K['clubIncome']
 names=['Park pitch','Main stand','Family stand','Both sides full, floodlights','Both ends','The dome']; row=1
 for lv,base in enumerate(I['ticketOffice']):
  n=row+1; s.write(row,0,f"{lv} {names[lv]}"); s.write_number(row,1,base,F['input']); s.write_number(row,2,0,F['input']); s.write_number(row,3,0,F['inputpct']); s.write_number(row,4,0,F['inputpct'])
  s.write_formula(row,5,f'=ROUND((B{n}+C{n})*(1+D{n}+E{n}),0)',F['calc'],base); s.write_formula(row,6,f'=F{n}*$B$10',F['calc'],base*I['capHours']); row+=1
 n=row+1; s.write(row,0,'Everything built'); s.write_number(row,1,I['ticketOffice'][-1],F['input']); s.write_number(row,2,I['clubShop'],F['input']); s.write_number(row,3,I['commercialBoost'][-1]/100,F['inputpct']); s.write_number(row,4,I['atmosphereBoost']/100,F['inputpct'])
 s.write_formula(row,5,f'=ROUND((B{n}+C{n})*(1+D{n}+E{n}),0)',F['calc'],I['rateMax']); s.write_formula(row,6,f'=F{n}*$B$10',F['calc'],I['fullOfficeMax']); row+=2
 s.write(row,0,'Cap, hours'); s.write_number(row,1,I['capHours'],F['input']); row+=1
 s.write(row,0,'Share of coins the modelled club spends on its ground'); s.write_number(row,1,I['groundShare'],F['inputpct']); row+=1
 s.merge_range(row,0,row+2,6,f"Blue cells are inputs: try the megastore ({I['clubShop']}), a manager (10%, 20%, 30%) or an atmosphere (up to {I['atmosphereBoost']}%) on any row. The clock only moves forward and the office stops at the cap, so a week away is one full office, and nothing is ever lost by staying away.",F['note']); row+=4
 for c,h in enumerate(['Profile','Days','Office coins a day','Other coins a day','Office share of the rest','Office rate at the end','Full office at the end']): s.write(row,c,h,F['head'])
 row+=1
 for x in cb['incomeShare']:
  n=row+1; s.write_row(row,0,[x['profile'],f"{x['from']} to {x['to']}",x['incomePerDay'],x['otherPerDay']]); s.write_formula(row,4,f'=IF(D{n}>0,C{n}/D{n},0)',F['pct'],ratio(x['incomePerDay'],x['otherPerDay'])); s.write_row(row,5,[x['rate'],x['fullOffice']]); row+=1
 s.write(row,0,'Guard rail (tests/economyBalance.test.ts): at most about a quarter at any stage; under a fifth for a regular player; under a tenth in week one.',F['note']); row+=3
 for c,h in enumerate(['Profile','Level 1, day','Level 2, day','Level 3, day','Level 4, day','Level 5, day','Rate day 1 / 30 / 90']): s.write(row,c,h,F['head'])
 row+=1
 for x in cb['groundLadder']:
  s.write_row(row,0,[x['profile']]+[day_txt(l['day']) if l['day'] is not None else 'Beyond the run' for l in x['levels']]+[f"{x['rateDay1']} / {x['rateDay30']} / {x['rateDay90']}"]); row+=1
 # --- the portal: nothing for sale, rewarded offers at a casual and a keen rate
 s=sheet('Portal',['Profile','Day','Gross coins','Gross gems','Gems from FREE GEMS ads (whole run)','Ground level','Office coins an hour'],[33,8,15,14,34,14,22]); row=1
 for p in cb['portalProfiles']:
  for x in p['marks']:
   s.write_row(row,0,[p['profile']['name'],x['day'],x['coins'],x['gems'],p['gemSources']['ads'] if x['day']==cb['horizon'] else '',x['ground'],x['incomeRate']]); row+=1
 row+=2
 for c,h in enumerate(['Profile','Goal','Currency','Cost','Day, everything saved for it','Day, planning share (40% coins, 75% gems)']): s.write(row,c,h,F['head'])
 row+=1
 for x in cb['afford']:
  s.write_row(row,0,[x['profile'],x['goal'],x['currency']]); s.write_number(row,3,x['cost'],F['int']); s.write(row,4,day_txt(x['dayAll'])); s.write(row,5,day_txt(x['dayShared'])); row+=1
 s.write(row,0,'Each goal alone: nothing else bought with that currency. The gem goals are cumulative where the name says so.',F['note']); row+=3
 for c,h in enumerate(['FREE GEMS offers a day','Profile','Offers taken a day','Loop gems a week, at most','Gems day 30','Gems day 90','Ad gems in 90 days','Club Pass, day','Local network, day','All three networks, day']): s.write(row,c,h,F['head']); s.set_column(c,c,max(22,[33,8,15,14,34,14,22,18,20,24][c]) if c<10 else 20)
 row+=1
 for x in cb['gemOffers']:
  s.write_row(row,0,[x['offers'],x['profile'],x['taken'],x['weeklyLoopMax'],x['gems30'],x['gems90'],x['adGems90'],day_txt(x['dayPass']),day_txt(x['dayLocal']),day_txt(x['dayAllNetworks'])]); row+=1
 s.merge_range(row+1,0,row+4,9,f"Chosen: {K['portalGemOffers']} offers a day on a portal, {K['gemsPerOffer']} gems each, one ad a reward, in the shop only (the apps keep one). Two keeps the week inside the 80 to 160 band; three would not (165). A casual player who takes one a visit is unaffected by the number.",F['text'])
# ---------------------------------------------------------------- the career, the balance checks and the ads (15 October 2026, economy v7)
# model.json 'career': ROAD TO GLORY simulated on the game's own engine (scripts/economy-model.ts modelCareer).
# Absent from an older model.json, in which case the workbook is the sheets above and nothing more.
cr=m.get('career')
if cr:
 start_sheet=r
 from xlsxwriter.utility import xl_rowcol_to_cell as rc, xl_col_to_name as cn
 F['pct1']=w.add_format({'num_format':'0.0%'}); F['pass']=w.add_format({'bold':True,'font_color':'#0B6B3A','bg_color':'#DDF3E4'}); F['fail']=w.add_format({'bold':True,'font_color':'#9C1C1C','bg_color':'#FBE0E0'})
 F['sub']=w.add_format({'bold':True,'font_size':13,'font_color':'#172434'}); F['calcpct']=w.add_format({'bg_color':'#E4F5EC','num_format':'0.0%'}); F['calcint']=w.add_format({'bg_color':'#E4F5EC','num_format':'#,##0'})
 A=cr['assumptions']; runs=cr['runs']; none=lambda v,alt='Beyond the run': v if v is not None else alt
 LOOPS=['calendar','daily','weekly','live','skill','mastery','journeys','passTrack','playStreak','matchOfDay','halfTimeShow','events']; ADS=['adGift','adMatch','adCoins']
 # --- Career By Season: the ledger, one row a finished season
 heads=['Profile','Season','Division','League','Finish','Outcome','Day from','Day to','Matches','Won','Drawn','Lost','Coins in','Coins out','Net (in less out)','Balance at the end','Lowest balance after spending',
  'IN: match fees','IN: megastore','IN: cup prizes','IN: season prize','IN: board','IN: sponsor','IN: commercial manager','IN: player sales','IN: card sales','IN: shared loops (gift, challenges, week, mastery, Journey, streak, match of the day)','IN: club income','IN: ads',
  'OUT: ground','OUT: staff fees','OUT: staff wages','OUT: wage drain','OUT: transfers','OUT: training','OUT: contracts','OUT: other cards',
  'Club matchday income (fees, megastore, sponsor, commercial)','Staff wages / club matchday income','Wages, drain and contracts / coins in','Player wages a week','Wage budget','Matchdays staff unpaid','Matchdays a wage drain took coins',
  'Team rating','Division par (rivals)','Squad','Ground level','Parts built (of 13)','Staff levels (of 18)','Gems in','Gems out','Gems at the end','Tickets in','Tickets out','Cards signed','Cards sold','Manager level',
  'Wage drain / club matchday income','Team rating over par']
 cs=sheet('Career By Season',heads,[40,8,9,18,8,11,9,8,9,6,7,6,11,11,12,14,16]+[13]*12+[12]*8+[18,16,16,12,12,12,14]+[10]*14+[16,12]); cs.set_row(0,62)
 COL={h:i for i,h in enumerate(heads)}; span={}; row=1
 for run in runs:
  first=row
  for x in run['seasons']:
   i=x['in']; o=x['out']; n=row+1
   vals=[run['profile']['name'],x['season'],x['division'],x['league'],x['position'],x['outcome'],x['dayFrom'],x['dayTo'],x['matches'],x['won'],x['drawn'],x['lost'],x['coinsIn'],x['coinsOut'],None,x['balanceEnd'],x['balanceMin'],
    i['matchFees'],i['megastore'],i['cupPrizes'],i['seasonPrizes'],i['board'],i['sponsor'],i['commercial'],i['playerSales'],i['cardSales'],sum(i[k] for k in LOOPS),i['clubIncome'],sum(i[k] for k in ADS),
    o['ground'],o['staffFees'],o['staffWages'],o['wageDrain'],o['transfers'],o['training'],o['contracts'],o['events'],
    None,None,None,x['playerWages'],x['wageBudget'],x['unpaidMatchdays'],x['drainMatchdays'],x['rating'],x['par'],x['squad'],x['ground'],x['partsBuilt'],x['staffLevels'],x['gemsIn'],x['gemsOut'],x['gemsEnd'],x['ticketsIn'],x['ticketsOut'],x['cardsSigned'],x['cardsSold'],x['level']]
   for c,v in enumerate(vals):
    if v is not None: cs.write(row,c,v)
   L=lambda h: f"{cn(COL[h])}{n}"
   cs.write_formula(row,COL['Net (in less out)'],f"={L('Coins in')}-{L('Coins out')}",F['calcint'],x['coinsIn']-x['coinsOut'])
   cs.write_formula(row,37,f"={L('IN: match fees')}+{L('IN: megastore')}+{L('IN: sponsor')}+{L('IN: commercial manager')}",F['calcint'],x['clubIncome'])
   cs.write_formula(row,38,f"=IF({cn(37)}{n}>0,{L('OUT: staff wages')}/{cn(37)}{n},0)",F['calcpct'],x['wageShare'])
   rec=(o['staffWages']+o['wageDrain']+o['contracts']+o['events'])/max(1,x['coinsIn'])
   cs.write_formula(row,39,f"=IF({L('Coins in')}>0,({L('OUT: staff wages')}+{L('OUT: wage drain')}+{L('OUT: contracts')}+{L('OUT: other cards')})/{L('Coins in')},0)",F['calcpct'],rec)
   # (Economy v8.) The wage drain against the club's own matchday income, and the eleven against its division's par.
   cs.write_formula(row,COL['Wage drain / club matchday income'],f"=IF({cn(37)}{n}>0,{L('OUT: wage drain')}/{cn(37)}{n},0)",F['calcpct'],o['wageDrain']/x['clubIncome'] if x['clubIncome']>0 else 0)
   cs.write_formula(row,COL['Team rating over par'],f"={L('Team rating')}-{L('Division par (rivals)')}",F['calcint'],x['rating']-x['par']); row+=1
  span[run['profile']['id']]=(first+1,row)
 cs.autofilter(0,0,row-1,len(heads)-1)
 seasons_end=row
 cs.merge_range(row+1,0,row+7,12,f"ROAD TO GLORY played matchday by matchday on the game's own engine for {cr['horizon']} days (seed {cr['seed']}): the league, the cups, the week at the club, the staff, the ground, the board and the event cards are the real rules. ASSUMED: who wins. The profile's mix (45/25/30, 60/20/20, 75/15/10) holds when the two elevens are level on Normal; every rating point between them moves {A['ratingPoint']*100:g} points of a hundred between wins and defeats (up to {A['ratingClamp']*100:g}); Hard (the Championship) takes {A['hard']*100:g} off the wins and Legend (the Elite League) {A['legend']*100:g}. THE MANAGER: keeps {A['reserveMatchdays']} matchdays of staff wages in the wallet; builds the cheapest part of the ground he can; hires staff in order while their wages stay under {A['staffShare']*100:g}% of what a league matchday brings; opens every pack and signs a card that beats a starter when the wage budget allows (a card obeys it now, like any signing), else sells it; once the ground is whole, puts {A['squadShare']*100:g}% of the coins that are his to spend into the eleven, on whatever lifts it most for the coins (a free agent at his asking price while the window is open, a scout's ready find, or a session for the weakest starter, the game's own TRAIN BEST), until it is {A['edge']} over his division's par, and in the Elite League toward {A['cap']}; buys the Local network, the Club Pass, then the other networks with gems. Everything else is saved: the balance is what is left for looks. Two more rows of the same player show the ends of that choice: cards only (no coin on players) and every spare coin on players. Only finished seasons are rows. Not player telemetry.",F['note'])
 # --- Career Tables: what the checks read
 ct=w.add_worksheet('Career Tables'); ct.set_column(0,0,44); ct.set_column(1,1,46); ct.set_column(2,15,16); row=0; REF={}
 def table(title,headers):
  global row
  ct.write(row,0,title,F['sub']); row+=1
  for c,h in enumerate(headers): ct.write(row,c,h,F['head'])
  ct.set_row(row,32); row+=1
 Q="'Career Tables'!"
 table('Headline by profile',['Profile','','Days modelled','Seasons finished','Division at the end','Coins earned','Coins spent','Balance at the end','Gems earned','Gems spent','Day his coins cover every sink, the eleven to the cap included (the day after the run: not inside it)','Average fee of a won match','Day, the ground, staff and looks only (the last pass\'s measure)','Coins on players (transfers and training)','Coins on players / coins earned'])
 for run in runs:
  n=row+1; players=run['coinsOut']['transfers']+run['coinsOut']['training']; earned=sum(run['coinsIn'].values())
  ct.write_row(row,0,[run['profile']['name'],'',run['horizon'],len(run['seasons']),run['end']['division'],earned,sum(run['coinsOut'].values()),run['end']['coins'],sum(run['gemsIn'].values()),sum(run['gemsOut'].values()),run['exhausted'] if run['exhausted'] is not None else run['horizon']+1,round(run['winAverage']),none(run['exhaustedLooks']),players])
  ct.write_formula(row,14,f'=IF(F{n}>0,N{n}/F{n},0)',F['calcpct'],players/earned if earned else 0)
  REF['exh:'+run['profile']['id']]=rc(row,10); REF['players:'+run['profile']['id']]=rc(row,14); row+=1
 row+=1; table('Promotions',['Profile','Promoted to','In season','On day'])
 for run in runs:
  for x in run['promotions']: ct.write_row(row,0,[run['profile']['name'],f"Division {x['division']}",x['season'],x['day']]); row+=1
 row+=1; table('Days to each goal',['Profile','Goal','Day'])
 GN={'midLook':'A mid look in the wallet (1,200 coins)','topLook':'A top look in the wallet (7,500 coins)','ground':'The whole ground built','staff':'Every member of staff at level 3','localNetwork':'Local Scouting Network','clubPass':'Club Pass','allNetworks':'All three Scouting Networks'}
 for run in runs:
  for k,name in GN.items(): ct.write_row(row,0,[run['profile']['name'],name,none(run['goalDays'][k])]); REF[f"goal:{run['profile']['id']}:{k}"]=rc(row,2); row+=1
 V8=cr.get('v8') or {}
 row+=1; table('The ground, part by part (Career regular)',['Part','','Coins','Day','Match','Matches since the last part','Day, the last pass (v7)','Difference'])
 b0=row; BD=(V8.get('before') or {}).get('buildDays',[])
 for i,x in enumerate(runs[1]['builds']):
  n=row+1; ct.write_row(row,0,[x['part'],'',x['cost'],x['day'],x['match'],x['sinceLast']])
  if i<len(BD): ct.write(row,6,BD[i]); ct.write_formula(row,7,f'=IF(G{n}>0,ABS(D{n}-G{n})/G{n},0)',F['calcpct'],abs(x['day']-BD[i])/BD[i] if BD[i] else 0)
  row+=1
 REF['builds']=f"{rc(b0,5)}:{rc(row-1,5)}"
 if V8:
  e0=b0; B=V8['before']
  for label,now,then in [('The lowest balance of the first 30 days',V8['low30'],B['lowestBalance']),('The first promotion, day',runs[1]['promotions'][0]['day'] if runs[1]['promotions'] else 999,B['firstPromotion'])]:
   n=row+1; ct.write_row(row,0,[label,'','',now]); ct.write(row,6,then); ct.write_formula(row,7,f'=IF(G{n}>0,ABS(D{n}-G{n})/G{n},0)',F['calcpct'],abs(now-then)/then if then else 0); row+=1
  REF['early']=f"{rc(e0,7)}:{rc(row-1,7)}"
 row+=1; table('By stage: club income, coins that need no match, and the welcome sheet\'s ad',['Profile','Days','Club income a day','Other coins a day','Club income / the rest','No-match coins a day','Match coins a day','No-match / match','Fee of a won match','Welcome sheet ad, coins','Ad in won matches'])
 s0=row; adrows=[]
 for x in cr['stages']:
  n=row+1; ct.write_row(row,0,[x['profile'],f"{x['from']} to {x['to']}",x['incomePerDay'],x['otherPerDay']]); ct.write_formula(row,4,f'=IF(D{n}>0,C{n}/D{n},0)',F['calcpct'],ratio(x['incomePerDay'],x['otherPerDay']))
  ct.write_row(row,5,[x['passivePerDay'],x['matchPerDay']]); ct.write_formula(row,7,f'=IF(G{n}>0,F{n}/G{n},0)',F['calcpct'],ratio(x['passivePerDay'],x['matchPerDay'])); ct.write_row(row,8,[x['winFee'],x['sheetAd']])
  ct.write_formula(row,10,f'=IF(I{n}>0,J{n}/I{n},0)',F['calc'],ratio(x['sheetAd'],x['winFee']))
  if x['profile']=='Career regular, every ad': adrows.append(row)
  row+=1
 REF['stageIncome']=f"{rc(s0,4)}:{rc(row-1,4)}"; REF['stagePassive']=f"{rc(s0,7)}:{rc(row-1,7)}"; REF['sheetAd']=f"{rc(adrows[0],10)}:{rc(adrows[-1],10)}"
 row+=1; table('Shared profiles, 90 days: coins that need no match against coins from matches',['Profile','','No-match coins','Match coins','No-match / match'])
 p0=row
 for x in cr['sharedPassive']:
  n=row+1; ct.write_row(row,0,[x['profile'],'',x['passive'],x['match']]); ct.write_formula(row,4,f'=IF(D{n}>0,C{n}/D{n},0)',F['calcpct'],x['share']); row+=1
 REF['sharedPassive']=f"{rc(p0,4)}:{rc(row-1,4)}"
 row+=1; table('The sponsor card, the same answer at every call (Career regular)',['Answer','','Coins','League matchdays','Coins a league matchday'])
 for x in cr['sponsor']:
  n=row+1; ct.write_row(row,0,[x['answer'],'',x['coins'],x['matchdays']]); ct.write_formula(row,4,f'=IF(D{n}>0,C{n}/D{n},0)',F['calc'],x['perMatchday']); REF['sp:'+x['answer']]=rc(row,4); row+=1
 row+=1; table('Trades that try to make coins without playing',['Trade','How','Division','Player OVR','Coins in','Coins back','Profit','Profit in league wins','A league win there'])
 a0=row; inst=[]; held=[]
 for x in cr['arbitrage']:
  n=row+1; ct.write_row(row,0,[x['trade'],x['how'],x['division'],x['ovr'],x['cost'],x['back']]); ct.write_formula(row,6,f'=F{n}-E{n}',F['calcint'],x['profit']); ct.write_formula(row,7,f'=IF(I{n}>0,G{n}/I{n},0)',F['calc'],x['wins']); ct.write(row,8,x['win'])
  (inst if x['instant'] else held if x['cost']>0 else []).append(row); row+=1
 REF['inst']=','.join(rc(i,6) for i in inst); REF['held']=','.join(rc(i,7) for i in held)
 row+=1; table('A league matchday by division, at a park pitch and at the dome (Career regular\'s results)',['League','','Division','Ground level','Par OVR','Win fee','Expected fee a match','Sponsor a match (no manager)','Megastore at home','Full staff wages','Full staff / matchday income','Wage budget','10% over budget costs a matchday','Relegated here with the wage bill of the division above: drain a matchday until players are sold','A par signing','A training session','Relegated here with a full squad of the division above: players to sell to be under the budget'])
 d0=row
 for x in cr['divisions']:
  ct.write_row(row,0,[x['league'],'',x['division'],x['stadium'],x['par'],x['winFee'],x['expectedFee'],x['sponsor'],x['megastoreHome'],x['fullStaffWages']]); ct.write_number(row,10,x['staffShare'],F['pct']); ct.write_row(row,11,[x['wageBudget'],x['tenOverCosts'],x['relegatedCosts'],x['parSigning'],x['session'],x.get('relegatedSales',0)]); row+=1
 REF['relSales']=f"{rc(d0,16)}:{rc(row-1,16)}"
 if V8:
  row+=1; table('Economy v8: what the market asks, what a session costs and the wage, by rating',['Rating','','Price before (OVR x OVR x 0.25)','Price now','Now / before','Wage a week (unchanged)','A session before (40 + 3 x OVR)','A session now','Now / before','A free pack card sells for, at once, after six league starts','The same card before this pass','Over what it sold for','At the market\'s price it would have sold for'])
  c0=row
  for x in V8['curves']:
   n=row+1; ct.write_row(row,0,[x['ovr'],'',x['priceBefore'],x['price']]); ct.write_formula(row,4,f'=IF(C{n}>0,D{n}/C{n},0)',F['calc'],x['price']/x['priceBefore'])
   ct.write_row(row,5,[x['wage'],x['sessionBefore'],x['session']]); ct.write_formula(row,8,f'=IF(G{n}>0,H{n}/G{n},0)',F['calc'],x['session']/x['sessionBefore'])
   ct.write_row(row,9,[x['freeCardSale'],x['freeCardBefore']]); ct.write_formula(row,11,f'=J{n}-K{n}',F['calcint'],x['freeCardSale']-x['freeCardBefore']); ct.write(row,12,x['marketWouldPay']); row+=1
  REF['freeCard']=f"{rc(c0,11)}:{rc(row-1,11)}"
  row+=1; table('Economy v8: what a pack draws, by division',['League','','Division','Par (an average eleven)','Level a card is drawn at (where the club\'s own eleven still counts: the most it can be)','The club\'s own eleven still counts, up to 52','Common from','Common to','Rare from','Rare to','Epic from','Epic to','Legend from','Legend to','A legend\'s best over par'])
  for x in V8['cards']:
   n=row+1; ct.write_row(row,0,[x['league'],'',x['division'],x['par'],x['level'],'YES' if x['ownEleven'] else 'NO',x['common']['from'],x['common']['to'],x['rare']['from'],x['rare']['to'],x['epic']['from'],x['epic']['to'],x['legend']['from'],x['legend']['to']])
   ct.write_formula(row,14,f'=N{n}-D{n}',F['calcint'],x['legend']['to']-x['par']); row+=1
  row+=1; table('Economy v8: the climb, the day each division is reached',['Profile','','District League','Sunday League','County League','National League','League One','Championship','Elite League','Elite League, the other two seeds'])
  for x in V8['pace']:
   days=[none(p['day'],'Not inside the run') for p in x['promotions']]
   ct.write_row(row,0,[x['profile'],'']+days+[', '.join(str(none(d,'not inside the run')) for d in x['topOtherSeeds'])])
   if x['profile']==runs[1]['profile']['name']: REF['top']=rc(row,8)
   row+=1
  row+=1; table('Economy v8: what coins buy. The eleven over its division\'s par, the mean of every season there, three seeds',['League','','Division','Cards only (no coin on players)','Half his spare coins on players','Every spare coin on players','Half, ahead of cards only','Seasons there: cards only','Seasons there: half','Seasons there: every coin'])
  k0=row
  for x in V8['coinsBuy']:
   n=row+1; ct.write_row(row,0,[x['league'],'',x['division']]); ct.write_number(row,3,x['cardsOnly'],F['dec']); ct.write_number(row,4,x['half'],F['dec']); ct.write_number(row,5,x['allIn'],F['dec']); ct.write_formula(row,6,f'=E{n}-D{n}',F['calc'],x['half']-x['cardsOnly'])
   ct.write_number(row,7,x['seasonsCardsOnly'],F['dec']); ct.write_number(row,8,x['seasonsHalf'],F['dec']); ct.write_number(row,9,x['seasonsAllIn'],F['dec'])
   if x['division']==4: k4=row
   row+=1
  REF['cardLevel']=f"{rc(k4,3)}:{rc(row-1,3)}"
  P=V8['pooled']; n=row+1; ct.write_row(row,0,['County League to League One, every season pooled','','5 to 3']); ct.write_number(row,3,P['cardsOnly'],F['dec']); ct.write_number(row,4,P['half'],F['dec']); ct.write_number(row,5,P['allIn'],F['dec']); ct.write_formula(row,6,f'=E{n}-D{n}',F['calc'],P['half']-P['cardsOnly']); REF['ahead']=rc(row,6); row+=1
  row+=1; table('Economy v8: who goes up. A manager who wins six in ten at par, by how far his eleven is from his division\'s (200 seasons each, the game\'s own league)',['Eleven against par','','Share of matches won','Promoted, share of seasons','Mean finish (of 8)','Seasons to go up'])
  for x in V8['odds']:
   n=row+1; ct.write_row(row,0,[('At par' if x['gap']==0 else f"{abs(x['gap'])} {'over' if x['gap']>0 else 'under'}"),'']); ct.write_number(row,2,x['pWin'],F['pct']); ct.write_number(row,3,x['promoted'],F['pct']); ct.write_number(row,4,x['meanPosition'],F['dec']); ct.write_formula(row,5,f'=IF(D{n}>0,1/D{n},0)',F['calc'],1/x['promoted'] if x['promoted'] else 0); row+=1
  row+=1; table('Economy v8: what is left to buy on day 180',['Manager','','Every one-time sink (the ground, the staff, every look)','The ground and staff he has paid for','His eleven to the cap (sessions, his discount)','In the wallet','Left to buy','Coins a week, the last four weeks','Weeks of income left'])
  GL=V8['goalLeft']
  for key,run in [('regular',runs[1]),('cardsOnly',runs[5]),('allIn',runs[6])]:
   g=GL[key]; n=row+1; once=run['rows'][-1]['oneTime']
   ct.write_row(row,0,[run['profile']['name'],'',V8['sinks'],once,g['ceiling'],g['wallet']]); ct.write_formula(row,6,f'=C{n}-D{n}+E{n}-F{n}',F['calcint'],V8['sinks']-once+g['ceiling']-g['wallet'])
   ct.write_number(row,7,g['week'],F['int']); ct.write_formula(row,8,f'=IF(H{n}>0,G{n}/H{n},0)',F['calc'],(V8['sinks']-once+g['ceiling']-g['wallet'])/g['week'] if g['week'] else 0)
   if key=='regular': REF['goalLeft']=rc(row,8)
   row+=1
  row+=1; table('Economy v8: the best player the Park and District Leagues ever show a club (60 careers each, every matchday)',['Measure','','Rating'])
  m0=row
  for label,val in [('Best player listed on the market',V8['market']['listed']),('Best player a level 3 scout finds',V8['market']['found'])]: ct.write_row(row,0,[label,'',val]); row+=1
  REF['bottom']=f"{rc(m0,2)}:{rc(row-1,2)}"
  ct.write_row(row,0,['Where the market\'s premium starts (PRICE_KNEE)','',V8['rules']['priceKnee']]); row+=1
  ct.write_row(row,0,['Where a session starts to cost more (TRAIN_KNEE)','',V8['rules']['trainKnee']]); row+=1
 row+=1; table('XP: the day and the match each level that unlocks something is reached',['Profile','Unlocks','Level','Day','Matches'])
 for x in cr['xp']: ct.write_row(row,0,[x['profile'],x['unlocks'],x['level'],none(x['day']),none(x['matches'])]); row+=1
 row+=1; table('Where it came from and where it went, the whole run',['Profile','Source or sink','Kind','Amount','Share of its kind'])
 for run in runs[:3]:
  for kind,key in [('Coins in','coinsIn'),('Coins out','coinsOut'),('Gems in','gemsIn'),('Gems out','gemsOut'),('Tickets in','ticketsIn'),('Tickets out','ticketsOut')]:
   tot=sum(run[key].values())
   for k,v in run[key].items():
    if v: ct.write_row(row,0,[run['profile']['name'],k,kind,v]); ct.write_number(row,4,v/tot if tot else 0,F['pct1']); row+=1
 row+=1; table('The balance every five days',['Profile','','Day','Balance','Earned so far','Spent so far','Gems','Division','Team rating'])
 chart2=w.add_chart({'type':'line'})
 for run in runs[:3]:
  f0=row
  for x in run['rows']: ct.write_row(row,0,[run['profile']['name'],'',x['day'],x['coins'],x['earned'],x['spent'],x['gems'],x['division'],x['rating']]); row+=1
  chart2.add_series({'name':run['profile']['name'],'categories':['Career Tables',f0,2,row-1,2],'values':['Career Tables',f0,3,row-1,3]})
 row+=1; table('The balance after every match (Career regular)',['Competition','Result','Match number','Day','Season','Division','Coins the match paid','Balance after the hub'])
 for x in cr['matchLedger']: ct.write_row(row,0,[x['competition'],x['result'],x['n'],x['day'],x['season'],x['division'],x['coins'],x['balance']]); row+=1
 chart2.set_title({'name':'Coins in the wallet after the club\'s spending'}); chart2.set_x_axis({'name':'Day'}); chart2.set_y_axis({'name':'Coins','min':0}); chart2.set_legend({'position':'bottom'}); chart2.set_size({'width':760,'height':380})
 cs.insert_chart(seasons_end+9,0,chart2)
 # --- Ads
 ad=cr['ads']; av=w.add_worksheet('Ads'); av.set_column(0,0,40); av.set_column(1,1,52); av.set_column(2,10,17); row=0
 def atable(title,headers):
  global row
  av.write(row,0,title,F['sub']); row+=1
  for c,h in enumerate(headers): av.write(row,c,h,F['head'])
  av.set_row(row,32); row+=1
 QA="'Ads'!"
 atable('Rewarded ads taken, by placement (a player who watches every one)',['Profile','Placement','Offered','Taken in the run','A day played','Coins','Gems','Coins each','Share of his coins','Share of his gems','What it is worth'])
 pl0=row; share_cells=[]
 for x in ad['placements']:
  av.write_row(row,0,[x['profile'],x['placement'],x['cap'],x['taken']]); av.write_number(row,4,x['perDay'],F['dec']); av.write_row(row,5,[round(x['coins']),x['gems'],round(x['coinsEach'])]); av.write_number(row,8,x['coinShare'],F['pct1']); av.write_number(row,9,x['gemShare'],F['pct1']); av.write(row,10,x['worth'])
  if x['profile']=='Career regular, every ad': share_cells.append(rc(row,8))
  row+=1
 av.set_column(10,10,70)
 row+=1; atable('Never an ad against every ad: the day each goal is reached (Career regular, three seeds)',['Goal','','No ads, day','Every ad, day','No ads / every ad'])
 g0=row
 for x in ad['goals']:
  n=row+1; av.write(row,0,x['goal'])
  if x['noAds'] is None or x['everyAd'] is None: av.write_row(row,2,[none(x['noAds']),none(x['everyAd']),'']); 
  else: av.write_number(row,2,x['noAds'],F['dec']); av.write_number(row,3,x['everyAd'],F['dec']); av.write_formula(row,4,f'=IF(D{n}>0,C{n}/D{n},0)',F['calc'],x['ratio'])
  row+=1
 REF['adRatio']=f"{QA}{rc(g0,4)}:{rc(row-1,4)}"; REF['adShare']='+'.join(QA+c for c in share_cells)
 row+=1; atable('Interstitials in a visit (blue cells are inputs)',['Input','','Value'])
 T=ad['timing']; av.write(row,0,'Minutes from a kick-off to half time'); av.write_number(row,2,T['kickToHalf'],F['input']); kh=rc(row,2,True,True); row+=1
 av.write(row,0,'Minutes from half time to the next kick-off'); av.write_number(row,2,T['halfToKick'],F['input']); hk=rc(row,2,True,True); row+=1
 av.write(row,0,'Minutes the portal asks for between two'); av.write_number(row,2,T['gap'],F['input']); gp=rc(row,2,True,True); row+=2
 for c,h in enumerate(['Profile','','Matches a visit','Minutes a visit','Interstitials, the save\'s first visit (model)','Interstitials, a later visit (formula)','An hour of play','Rewarded ads a day played']): av.write(row,c,h,F['head'])
 av.set_row(row,32); row+=1
 for x in ad['visits']:
  n=row+1; av.write_row(row,0,[x['profile'],'',x['matches']]); av.write_formula(row,3,f'=C{n}*({kh}+{hk})',F['calc'],x['minutes']); av.write(row,4,x['firstVisit'])
  av.write_formula(row,5,f'=IF(AND({kh}>={gp},{hk}>={gp}),2*C{n}-1,IF({kh}+{hk}>={gp},C{n},ROUNDUP(C{n}*({kh}+{hk})/{gp},0)))',F['calc'],x['laterVisit'])
  av.write_formula(row,6,f'=IF(D{n}>0,F{n}/D{n}*60,0)',F['calc'],x['perHour']); av.write_number(row,7,x['rewardedPerDay'],F['dec']); row+=1
 av.merge_range(row+1,0,row+5,9,'THE RULE MODELLED: one interstitial before a kick-off, never the first match of a visit; one at half time; none until two matches are finished on the save; and the portal\'s SDK lets one through every 3 minutes at most. At the default 2 minute halves half time comes 2.5 minutes after a kick-off ad, inside the 3 minutes, so a visit of N matches shows N: the half time of the first match and the kick-off of every later one. One every six minutes, ten an hour. With 3 minute halves both slots clear the gap and it would be 2N - 1. Rewarded ads are the player\'s choice and are counted apart. MODELLED, NOT BUILT HERE: the welcome sheet\'s ad doubling the ticket office, HEAL A PLAYER by ad, the replay ad, the half time interstitial. Club Run is not in the career simulation.',F['note'])
 # --- Balance Checks: one row a check; the measured value is a formula over the data wherever the data is on a sheet
 bc=sheet('Balance Checks',['Area','Check','The bar','Limit','Measured','Result','Before this pass (economy v7, 15 October 2026)','Unit','What it shows'],[13,74,30,10,13,10,18,11,110]); row=1
 CS="'Career By Season'!"; rng=lambda col,ids: ','.join(f"{CS}{cn(col)}{span[i][0]}:{cn(col)}{span[i][1]}" for i in ids if span[i][1]>=span[i][0])
 pol=['career-learning','career-regular','career-strong']; G=lambda i,k: Q+REF[f'goal:{i}:{k}']
 FX={
  'wages-paid':f"=SUM({rng(42,pol)})",
  'wage-drain':f"=SUM({rng(32,pol)})/SUM({rng(37,pol)})",
  'wage-share':f"=MAX({rng(38,pol)})",
  'collector-spiral':f"=MAX({rng(39,['career-regular-collector'])})",
  'ground-part':f"=MAX({Q}{REF['builds']})",
  'ground-whole':f"={G('career-regular','ground')}",'staff-whole':f"={G('career-regular','staff')}",'mid-look':f"={G('career-regular','midLook')}",'top-look':f"={G('career-regular','topLook')}",
  'passive':f"=MAX({Q}{REF['stagePassive']},{Q}{REF['sharedPassive']})",
  'club-income':f"=MAX({Q}{REF['stageIncome']},'Club Income'!E17:E40)",
  'sponsor':f"={Q}{REF['sp:CASH NOW']}/{Q}{REF['sp:EVERY MATCH']}",
  'flip-instant':f"=MAX({','.join(Q+c for c in REF['inst'].split(','))})",'flip-held':f"=MAX({','.join(Q+c for c in REF['held'].split(','))})",
  'squad-sink':f"=SUM({rng(33,['career-regular'])},{rng(34,['career-regular'])})/SUM({rng(13,['career-regular'])})",
  'sinks-last':f"={Q}{REF['exh:career-regular']}",
  'ads-twice':f"=MAX({REF['adRatio']})",'ad-single':f"=MAX({Q}{REF['sheetAd']})",'ad-share':f"={REF['adShare']}",
 }
 # (Economy v8.) The new checks read the v8 tables of Career Tables and the two new columns of Career By Season.
 if V8:
  FX.update({
   'squad-coins':f"={Q}{REF['players:career-regular']}",'coins-ahead':f"={Q}{REF['ahead']}",'card-level':f"=MAX({Q}{REF['cardLevel']})",'goal-left':f"={Q}{REF['goalLeft']}",
   'strong-sinks':f"={Q}{REF['exh:career-strong']}",'top-pace':f"={Q}{REF['top']}",'early-ledger':f"=MAX({Q}{REF['early']})",'early-prices':f"=MAX({Q}{REF['bottom']})",
   'free-card':f"=MAX({Q}{REF['freeCard']})",'card-budget':f"=MAX({rng(COL['Wage drain / club matchday income'],['career-regular-collector'])})",'relegated-exit':f"=MAX({Q}{REF['relSales']})",
  })
 regs=runs[1]['seasons']; adstages=[x for x in cr['stages'] if x['profile']=='Career regular, every ad']
 SHEET={
  'club-income':max([ratio(x['incomePerDay'],x['otherPerDay']) for x in cr['stages']]+[ratio(x['incomePerDay'],x['otherPerDay']) for x in (cb['incomeShare'] if cb else [])]),
  'passive':max([ratio(x['passivePerDay'],x['matchPerDay']) for x in cr['stages']]+[x['share'] for x in cr['sharedPassive']]),
  'squad-sink':ratio(sum(x['out']['transfers']+x['out']['training'] for x in regs),sum(x['coinsOut'] for x in regs)),
  'ad-single':max(ratio(x['sheetAd'],x['winFee']) for x in adstages),
 }
 for x in cr['checks']:
  n=row+1; share=x['unit']=='share'; fmt=F['calcpct'] if share else F['calc']; shown=SHEET.get(x['id'],x['value']) if x['id'] in FX else x['value']
  ok=shown<=x['limit'] if x['op']=='<=' else shown>=x['limit']
  bc.write_row(row,0,[x['area'],x['check'],x['bar']]); bc.write_number(row,3,x['limit'],F['inputpct'] if share else F['input'])
  if x['id'] in FX: bc.write_formula(row,4,FX[x['id']],fmt,shown)
  else: bc.write_number(row,4,x['value'],F['pct1'] if share else F['dec'])
  bc.write_formula(row,5,f'=IF(E{n}{x["op"]}D{n},"PASS","FAIL")',F['pass'] if ok else F['fail'],'PASS' if ok else 'FAIL')
  if x['before'] is not None: bc.write_number(row,6,x['before'],F['pct1'] if share else F['dec'])
  bc.write(row,7,x['unit']); bc.write(row,8,x['note'],F['text']); bc.set_row(row,46); row+=1
 bc.conditional_format(1,5,row-1,5,{'type':'cell','criteria':'==','value':'"PASS"','format':F['pass']}); bc.conditional_format(1,5,row-1,5,{'type':'cell','criteria':'==','value':'"FAIL"','format':F['fail']})
 passed=sum(1 for x in cr['checks'] if x['pass']); failed=[x for x in cr['checks'] if not x['pass']]
 bc.merge_range(row+1,0,row+5,8,'HOW TO READ IT: the green Measured cells are formulas over Career By Season, Career Tables, Club Income and Ads; the blue Limit cells are the bars. Change a limit, or a number on those sheets, and the result moves. A value with no formula is the model\'s own measurement (scripts/economy-model.ts) and moves only when the model is run again. "Before this pass" is the same measurement on the rules of 15 October 2026 (economy v7); for the checks added on 16 October it is what the v7 output showed for the same thing, where it had the number. A day shown as 181 is the day after the run: not inside the 180 days modelled. The club income check reads the share rows of the Club Income sheet (rows 14 to 40) and the stage table of Career Tables.',F['note'])
 # --- Start Here: the verdict in plain words
 v=after+8
 gap=lambda x: 'at par' if x['gap']==0 else f"{abs(x['gap'])} {'over' if x['gap']>0 else 'under'} par"
 if V8:
  CK={x['id']:x for x in cr['checks']}; reg=runs[1]; GLr=V8['goalLeft']['regular']; cv={x['ovr']:x for x in V8['curves']}
  odds_txt=', '.join(f"{x['promoted']*100:.0f}% of seasons {gap(x)}" for x in V8['odds']); failed_txt='; '.join(x['check'] for x in failed) or 'none'
  start_sheet.merge_range(v,1,v,7,'16 OCTOBER 2026, ECONOMY V8: PLAYERS COST COINS',F['sub'])
  start_sheet.merge_range(v+1,1,v+6,7,f"{passed} of {len(cr['checks'])} checks pass on the sheet Balance Checks: every one of the 22 of 15 October (the two that failed then, squad-sink and sinks-last, are settled) and {passed-22} of the {len(cr['checks'])-22} added today. THE ONE THAT FAILS: {failed_txt}. It is day {CK['top-pace']['value']:g} against a bar of day 90 to 150, and no price can move it: a manager who wins six in ten at par is promoted in {odds_txt} (the table Who goes up on Career Tables). That one is the owner's to decide: it is about who goes up, not about what players cost.",F['text'])
  start_sheet.merge_range(v+8,1,v+13,7,f"WHAT CHANGED. (1) A scout card is drawn at the division's level, not at the club's own eleven: on cards alone a regular player's eleven is {CK['card-level']['value']:.1f} over par at the most (it was 7 to 20 over). (2) The market's price is what it was up to 60 OVR and climbs above it: a 75 costs {cv[75]['price']:,} (it was {cv[75]['priceBefore']:,}), an 85 {cv[85]['price']:,} ({cv[85]['priceBefore']:,}), a 95 {cv[95]['price']:,} ({cv[95]['priceBefore']:,}), a 99 {cv[99]['price']:,} ({cv[99]['priceBefore']:,}). (3) A session costs what it did up to 70 OVR and more the closer he is to 100: {cv[85]['session']:,} at 85 ({cv[85]['sessionBefore']}), {cv[95]['session']:,} at 95 ({cv[95]['sessionBefore']}), {cv[99]['session']:,} at 99 ({cv[99]['sessionBefore']}). (4) What a club is PAID for a player it never bought is unchanged at every rating; a signing gives back his fee at the most. (5) A card obeys the wage budget. Wages are unchanged. Nothing a player owns or was paid changes.",F['text'])
  start_sheet.merge_range(v+15,1,v+19,7,f"WHAT IT DOES. A regular player puts {reg['coinsOut']['transfers']+reg['coinsOut']['training']:,.0f} coins into players in 180 days ({CK['squad-coins']['value']*100:.0f}% of all he earns; it was 0). On day 180 he still has {GLr['coins']:,.0f} coins of things to buy, {CK['goal-left']['value']:.0f} weeks of his income (before, he had paid for everything by day 57 and banked 24,000 a week). A strong player who watches every ad has coins for everything on day {CK['strong-sinks']['value']:g} (it was day 25). The first 30 days are what they were: the ground on the same days, the first promotion on day {reg['promotions'][0]['day']}, the same lowest balance. ASSUMED, and written out under the table on Career By Season: who wins, and that the manager puts {A['squadShare']*100:g}% of his spare coins into the eleven. The tables are on Career Tables, each headed Economy v8.",F['text'])
  v+=21
 start_sheet.merge_range(v,1,v,7,'15 OCTOBER 2026, ECONOMY V7: THE WHOLE ECONOMY CHECKED',F['sub'])
 start_sheet.merge_range(v+1,1,v+4,7,'The pass before this one played ROAD TO GLORY itself for 180 days and held it to 22 bars. Three numbers changed then (nothing a player owns): the ticket office pays 16 / 18 / 20 / 22 / 24 / 26 coins an hour instead of 16 / 19 / 22 / 25 / 28 / 32; a new sponsor calls 8 league matchdays after the last instead of 3; a home town scout\'s fee is 0.8 of the going rate instead of 0.75. Two bars were left failing for the owner to decide (players cost no coins; every sink paid for by day 57): economy v8, above, is that decision.',F['text'])
 start_sheet.merge_range(v+6,1,v+7,7,'SHEETS: Career By Season (the career simulated season by season), Career Tables (what the checks read, and the Economy v8 tables), Balance Checks (the bar, the measured value, PASS or FAIL, and the value before this pass) and Ads (rewarded ads by placement, the no-ad comparison, interstitials a visit).',F['text'])
w.close(); print(out.resolve())

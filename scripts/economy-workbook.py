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
r.merge_range('B5:H6','The game has a viable free route. Fix repeat payouts and card-sale inflation before raising prices. Coins develop the club; gems buy guaranteed identities, permanent passes and optional shortcuts.',F['text'])
r.merge_range('B8:H9','HOW TO USE: blue cells in Goals are editable. Green cells recalculate saving time. Source Outputs show exact seeded model results; they do not change when you edit a planning assumption.',F['text'])
r.merge_range('B11:H12','WHAT THIS IS: a repeatable planning model, not measured retention, conversion, profit or proof that the game feels fun. Currency totals are gross earnings before spending.',F['text'])
for i,note in enumerate(m['assumptions']):
 row=14+i*2; r.merge_range(row,1,row+1,7,note,F['note'])
r.merge_range('B37:H39','Regenerate: npm run economy:model, then run scripts/economy-workbook.py with Python + xlsxwriter. Review after changes to rewards, match length, player progression or purchases. No monthly content update is required by the twelve permanent Journeys.',F['text'])
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
w.close(); print(out.resolve())

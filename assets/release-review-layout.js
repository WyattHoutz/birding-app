'use strict';

async function releaseReviewLayout(scan, mutation, stage=()=>{}) {
  const A=window.__app, results=[];
  const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  async function until(predicate,label) {
    stage('release review waiting: '+label);
    const start=performance.now();
    while(!predicate()) {
      if(performance.now()-start>5000)throw new Error(label+' did not become ready');
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    stage('release review painting: '+label);
    await paint();
  }
  function fits(node) {
    const box=node.getBoundingClientRect();
    check(box.width>0&&box.left>=-.5&&box.right<=innerWidth+.5
      &&node.scrollWidth<=node.clientWidth+1,'clipped review content: '+node.textContent
        +' '+JSON.stringify({box:box.toJSON(),scroll:node.scrollWidth,client:node.clientWidth}));
    const range=document.createRange();range.selectNodeContents(node);
    check([...range.getClientRects()].every(r=>r.left>=box.left-1&&r.right<=box.right+1),
      'text escaped its review control: '+node.textContent);
    return box;
  }
  async function record(label,fixture) {
    stage(label);
    try {
      let measured;
      const geometry=await fixture(()=>{measured=scan(label);});
      results.push(Object.assign(measured||scan(label),{releaseReviewGeometry:geometry}));
    }
    catch(error) {results.push({label,fixtureError:error.message});}
    stage(label+' complete');
  }
  A.cancelStalledWork();A.setActiveReport('wa');A.setCountyView('');
  await record('F1504 actual Storm-Petrel taxonomy and F1505 scope palette',async()=>{
    const species=[
      ['lcspet',"Leach's Storm-Petrel",'Hydrobates leucorhous'],
      ['tospet',"Townsend's Storm-Petrel",'Hydrobates socorroensis'],
      ['aispet',"Ainley's Storm-Petrel",'Hydrobates cheimomnestes'],
      ['blkpet','Black Storm-Petrel','Hydrobates melania'],
      ['wilpet',"Wilson's Storm-Petrel",'Oceanites oceanicus'],
      ['gull','Example Gull','Larus example']
    ].map((row,i)=>({speciesCode:row[0],comName:row[1],sciName:row[2],category:'species',
      order:i===5?'Charadriiformes':'Procellariiformes',
      familySciName:i===5?'Laridae':i===4?'Oceanitidae':'Hydrobatidae',taxonOrder:i+1}));
    const uncertain=[
      ['bird','bird sp.','Aves sp.','spuh'],
      ['storm','storm-petrel sp.','Procellariiformes sp.','spuh'],
      ['dark','storm-petrel sp. (dark-rumped)','Procellariiformes sp. (dark-rumped)','spuh'],
      ['white','storm-petrel sp. (white-rumped)','Procellariiformes sp. (white-rumped)','spuh'],
      ['hydro','Hydrobates sp.','Hydrobates sp.','spuh'],
      ['complex','Hydrobates sp. (Band-rumped complex)','Hydrobates sp. (Band-rumped complex)','spuh'],
      ['three',"Leach's/Townsend's/Ainley's Storm-Petrel",'Hydrobates leucorhous/socorroensis/cheimomnestes','slash'],
      ['two',"Leach's/Townsend's Storm-Petrel",'Hydrobates leucorhous/socorroensis','slash'],
      ['two-dark',"Leach's/Townsend's Storm-Petrel (dark-rumped)",'Hydrobates leucorhous/socorroensis (dark-rumped)','slash'],
      ['two-white',"Leach's/Townsend's Storm-Petrel (white-rumped)",'Hydrobates leucorhous/socorroensis (white-rumped)','slash']
    ].map((row,i)=>({speciesCode:row[0],comName:row[1],sciName:row[2],category:row[3],
      order:row[0]==='bird'?'':'Procellariiformes',taxonOrder:100+i}));
    A.setSpuhModel(window.Spuh.createFromTaxonomy(species.concat(uncertain)));
    A.showSection('sec-spLookupBtn',{load:false});
    A.lookupSpecies('lcspet',"Leach's Storm-Petrel");
    await until(()=>document.querySelector('#spLookupTaxonomy .spuhpathselected'),'actual selected taxonomy');
    const taxonomy=document.getElementById('spLookupTaxonomy');
    const path=taxonomy.querySelector('.spuhpathsentence');
    const chips=[...path.querySelectorAll('[data-compact-label]')];
    check(chips.length===11,'actual taxonomy lost a Storm-Petrel relationship: '+chips.map(n=>n.textContent));
    check(path.tagName==='OL'&&path.firstElementChild.classList.contains('selected')
      &&chips[0].dataset.compactLabel==="Leach's Storm-Petrel"
      &&chips.at(-1).dataset.compactLabel==='bird sp.','selected-to-broad order changed');
    if(mutation==='taxonomy-indent')chips[2].style.marginLeft='12px';
    const heading=taxonomy.querySelector('h3').getBoundingClientRect();
    const selected=fits(chips[0]),related=fits(chips[1]);
    check(Math.abs(selected.left-heading.left)<.5,'selected species is not flush left');
    for(const chip of chips) {
      const box=fits(chip),style=getComputedStyle(chip);
      if(chip.tagName==='BUTTON'&&document.documentElement.getAttribute('data-a11y')==='on') {
        if(mutation==='taxonomy-targets')chip.style.minHeight='0px';
        const target=chip.getBoundingClientRect();
        check(target.width>=43.5&&target.height>=43.5,'taxonomy action is below the accessible target size');
      }
      check(chip===chips[0]||Math.abs(box.left-related.left)<.5,'related taxonomy columns are misaligned');
      check(style.fontWeight===(chip===chips[0]?'700':'400'),'related taxon acquired selected emphasis');
      check(style.fontStyle===(chip.dataset.category==='spuh'?'italic':'normal'),'category typography changed');
      if(chip.classList.contains('limited'))check(style.borderTopStyle==='dashed'
        &&chip.querySelector('[aria-label="Coverage limit"]'),'coverage limit lost its noncolor warning');
    }
    check(path.querySelectorAll('.spuhpatharrow svg').length===5
      &&path.querySelectorAll('.spuhsiblingsep').length===5,'relationship markers changed');
    const markers=[...path.querySelectorAll('.spuhpatharrow,.spuhsiblingsep')];
    const center=node=>{const box=fits(node);return box.left+box.width/2;};
    check(markers.every(node=>Math.abs(center(node)-center(markers[0]))<.5),'arrow and or columns differ');
    const tag=document.getElementById('navScopeTag');
    if(mutation==='scope-outline')tag.style.border='0';
    const style=getComputedStyle(tag);
    check(style.borderTopStyle==='solid'&&parseFloat(style.borderTopWidth)>=2
      &&style.borderTopColor==='rgb(161, 191, 179)'
      &&style.backgroundColor==='rgb(72, 124, 100)'&&style.color==='rgb(255, 255, 255)',
      'scope palette or visible outline changed');
    fits(tag);
    return {labels:chips.map(n=>n.dataset.compactLabel),levels:path.children.length,aligned:true,
      supportingHotspotAcquisition:'cancelled after taxonomy-only review'};
  });
  A.cancelStalledWork();
  await record('F1506 actual saved-Home county choice',async capture=>{
    A.setActiveReport('wa');A.setCountyView('');
    localStorage.setItem(A.homeKey('lat'),'47.6');localStorage.setItem(A.homeKey('lng'),'-122.3');
    A.openRegionChooser();
    try {
      await until(()=>document.querySelector('#regionChooserCountyShortcut [data-region-choice="county:wa:US-WA-033"]'),
        'verified Home county');
      const button=document.querySelector('#regionChooserCountyShortcut button');
      const recent=document.getElementById('regionChooserRecent');
      if(!document.getElementById('regionChooserRecentSection').hidden) {
        check(['auto','scroll'].includes(getComputedStyle(recent).overflowX),
          'Recent choices lost their horizontally scrollable strip');
        for(const choice of recent.children) {
          recent.scrollLeft+=choice.getBoundingClientRect().left-recent.getBoundingClientRect().left-2;
          await paint();
          const rect=choice.getBoundingClientRect(),strip=recent.getBoundingClientRect();
          check(rect.left>=strip.left-.5&&rect.right<=strip.right+.5
            &&choice.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)),
            'a Recent choice is not reachable in the real chooser');
        }
        recent.scrollLeft=0;
      }
      document.getElementById('regionChooserCountyShortcut').scrollIntoView({block:'center'});
      await paint();fits(button);fits(document.getElementById('regionChooserCountySource'));
      check(A.getCountyView()===''&&!button.disabled,'Home county must remain an explicit unselected action');
      capture();
      button.click();
      check(A.getCountyView()==='US-WA-033','county shortcut did not select its actual view');
      return {county:'US-WA-033',explicitSelection:true};
    } finally {document.getElementById('regionChooserClose').click();A.setCountyView('');}
  });
  await record('F1507 actual Home map, explicit Save and Cancel',async capture=>{
    A.openSavedLocationEditor('home');
    const saved=JSON.stringify(A.getHome()),place=document.getElementById('homePlace');
    place.value='47.7, -122.2';place.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('geocodeBtn').click();
    await until(()=>!document.getElementById('homeDeviceSave').hidden,'Home map review');
    const review=document.getElementById('homeCandidateReview'),map=document.getElementById('homeCandidateMap');
    if(mutation==='home-map')map.style.height='0px';
    const box=fits(map);fits(document.getElementById('homeCandidateSummary'));fits(review);
    fits(document.getElementById('homeCandidateConsent'));
    check(box.height>=180&&map.querySelector('.mapcanvas,svg'),'candidate map has no usable area');
    check(JSON.stringify(A.getHome())===saved,'map review saved an unapproved Home');
    for(const id of ['homeDeviceSave','homeCandidateCancel']) {
      const button=document.getElementById(id);button.scrollIntoView({block:'center'});await paint();
      const rect=fits(button),hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
      check(rect.height>=43.5&&rect.width>=43.5&&hit&&button.contains(hit),'Home approval is not usable: '+id
        +' '+JSON.stringify({rect:rect.toJSON(),hit:hit&&hit.outerHTML.slice(0,140)}));
    }
    capture();document.getElementById('homeCandidateCancel').click();
    check(review.hidden&&JSON.stringify(A.getHome())===saved,'Cancel changed saved Home');
    return {mapHeight:box.height,explicitSave:true,cancelPreserved:true};
  });
  await record('F1508 actual unsupported ABA Twitches',async capture=>{
    A.setActiveReport('aba');A.showSection('sec-refreshBtn',{load:false});
    await A.refresh();await paint();
    const panel=document.getElementById('twitchesUnavailable');
    const button=document.getElementById('twitchesChooseRegion');
    check(!panel.hidden&&document.getElementById('refreshBtn').disabled,'unsupported Twitches offered Refresh');
    fits(document.getElementById('status'));
    button.scrollIntoView({block:'center'});await paint();fits(button);
    capture();
    button.click();check(!document.getElementById('regionChooser').hidden,'Choose region is not the actual chooser');
    document.getElementById('regionChooserClose').click();
    A.setActiveReport('wa');window.scrollTo(0,0);
    return {unavailable:true,chooseRegion:true};
  });
  await record('F1511 actual primary hotspot and additional locations',async()=>{
    A.clearSpeciesLookup();
    const sources=[
      {locId:'L1511A',locName:'Representative Park -- South',lat:47.7,lng:-122.2},
      {locId:'L1511B',locName:'Representative Park -- North boardwalk and observation platform',lat:47.701,lng:-122.201},
      {locId:'P1511',locName:'Nearby private garden',lat:47.702,lng:-122.202,locationPrivate:true}
    ].map((source,index)=>Object.assign({speciesCode:'lcspet',comName:"Leach's Storm-Petrel",
      subId:'S1511'+index,obsDt:A.todayStr()+' 09:00',howMany:1,obsValid:true},source));
    A.seedEbirdCache(A.speciesLookupPath('US-WA','lcspet',A.SP_LOOKUP_BACK),sources);
    A.showSection('sec-spLookupBtn',{load:false});
    A.lookupSpecies('lcspet',"Leach's Storm-Petrel");
    A.setSpeciesLookupWithinChase(false);A.setSpeciesLookupGrouped(true);
    await until(()=>document.querySelector('#spLookupRecent .spLookupPlaceList > .hscard-md'),
      'actual grouped hotspot');
    A.cancelStalledWork();
    const card=document.querySelector('#spLookupRecent .spLookupPlaceList > .hscard-md');
    const primary=card.querySelector(':scope > .name .hslink');
    if(mutation==='primary-link')primary?.removeAttribute('data-loc');
    check(primary?.dataset.loc==='L1511B'&&primary.tabIndex===0,
      'group header must target the existing public primary hotspot');
    check(primary.textContent===sources[1].locName,'primary header changed the hotspot name');
    const additional=card.querySelector('.stakeoutIncludedLocations');
    check(additional.querySelector('.rankhead').textContent==='Additional locations'
      &&additional.querySelectorAll('.hscard-sm').length===2
      &&!additional.querySelector('[data-loc="L1511B"]'),'primary hotspot was repeated among additional locations');
    primary.scrollIntoView({block:'center'});await paint();fits(primary);
    const rect=[...primary.getClientRects()].find(box=>box.width&&box.height);
    check(primary.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)),
      'primary hotspot header is not independently clickable');
    for(const source of additional.querySelectorAll('.hscard-sm'))fits(source);
    primary.click();
    check(document.getElementById('stakeHs').value===sources[1].locName
      &&!document.getElementById('sec-stakeHsBtn').hidden,'primary header did not open its actual Stakeout Patch');
    A.cancelStalledWork();A.showSection('sec-spLookupBtn',{load:false});await paint();
    return {primary:'L1511B',additional:2,exactName:true,patchOpened:true};
  });
  return results;
}

module.exports=releaseReviewLayout;

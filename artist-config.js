'use strict';
/* Artist settings are independent from shared calendar/UI behavior.
 * These verified official URLs identify information sources, not live connections. */
globalThis.ALERT_ARTISTS = Object.freeze([
  {id:"batten",name:"ばってん少女隊",shortName:"ばっしょー",accent:"#b45631",officialUrl:"https://battengirls.com/",sources:[{label:"公式ニュース",url:"https://battengirls.com/contents/news"},{label:"公式カレンダー",url:"https://battengirls.com/calendar"},{label:"公式チケット",url:"https://battengirls.com/contents/654889"}]},
  {id:'ebichu',name:'私立恵比寿中学',shortName:'エビ中',buttonName:'エビ中',accent:'#d85a92',officialUrl:'https://www.shiritsuebichu.jp/',sources:[{label:'公式ニュース',url:'https://www.shiritsuebichu.jp/news/'},{label:'公式スケジュール',url:'https://www.shiritsuebichu.jp/media/'},{label:'公式X',url:'https://x.com/ebichu_staff'}]},
  {id:'tokisen',name:'超ときめき♡宣伝部',shortName:'超とき宣',accent:'#e84686',officialUrl:'https://toki-sen.com/',sources:[{label:'公式ニュース',url:'https://toki-sen.com/contents/news'},{label:'公式カレンダー',url:'https://toki-sen.com/calendar'}]},
  {id:'re-ge',name:'RE-GE',shortName:'RE-GE',accent:'#6f5fe8',officialUrl:'https://re-ge.com/',sources:[{label:'公式サイト',url:'https://re-ge.com/'}]},
  {id:'straightangeli',name:'Straight Angeli',shortName:'Straight Angeli',accent:'#579bb1',officialUrl:'https://straight-angeli.com/',sources:[{label:'公式ニュース',url:'https://straight-angeli.com/news/'},{label:'公式スケジュール',url:'https://straight-angeli.com/schedule/'},{label:'公式X',url:'https://x.com/stan__staff'}]},
  {id:'oneloveoneheart',name:'ONE LOVE ONE HEART',shortName:'ラブワン',buttonName:'ラブワン',accent:'#255f65',officialUrl:'https://oneloveoneheart.jp/',sources:[{label:'公式ニュース',url:'https://oneloveoneheart.jp/news/'},{label:'公式ライブ',url:'https://oneloveoneheart.jp/live/'},{label:'公式メディア',url:'https://oneloveoneheart.jp/media/'}]},
  {id:'tohokusan',name:'いぎなり東北産',shortName:'東北産',buttonName:'産',accent:'#b2509a',officialUrl:'https://madeintohoku.com/',sources:[{label:'公式スケジュール',url:'https://madeintohoku.com/contents/schedule'},{label:'公式ニュース',url:'https://madeintohoku.com/contents/news'},{label:'公式チケット',url:'https://madeintohoku.com/contents/ticket'}]}
]);

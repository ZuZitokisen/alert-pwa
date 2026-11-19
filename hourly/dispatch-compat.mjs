// Temporary rollout boundary for the existing four-artist notification backend.
// Extend only after backend validation AND common recipient eligibility are verified.
// This does not create subscriptions or change a device's notification opt-in.
const reminderArtists=new Set(['tokisen','re-ge','straightangeli','oneloveoneheart']);
export function compatibleDispatch(planned){
 const records=[];let deferredUnsupportedReminders=0;
 for(const notice of planned){
  if(notice.kind==='reminder'&&!reminderArtists.has(notice.artistId)){
   deferredUnsupportedReminders++;continue;
  }
  // The common News envelope is already compatible and covers all artists.
  records.push(notice);
 }
 return {records,deferredUnsupportedReminders};
}

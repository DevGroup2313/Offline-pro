/* Tests for src/lib/learner_core.js: node tools/grammar/learner_test.js
   Each sentence is a learner's slip checked by hand, or correct text that
   must be left alone. */
const path = require('path');
const L = require(path.join(__dirname, '..', '..', 'src', 'lib', 'learner_core.js'));
let pass = 0; const fails = [];
function ok(name, cond, got) { if (cond) pass++; else fails.push(name + (got !== undefined ? '\n  got: ' + JSON.stringify(got) : '')); }
const apply = (t, E) => { let out = '', pos = 0; for (const e of E) { if (e.start < pos) continue; out += t.slice(pos, e.start) + e.fix; pos = e.end; } return out + t.slice(pos); };
const fix = (t, fam) => apply(t, L.check(t, fam ? { only: fam } : null));
const same = (name, t, fam) => ok(name, fix(t, fam) === t, L.check(t, fam ? { only: fam } : null).map(e => [e.orig, e.fix, e.fam]));
const to = (name, t, want, fam) => ok(name, fix(t, fam) === want, fix(t, fam));

/* agreement */
to('he go → goes', 'Every morning he go to school by bus.', 'Every morning he goes to school by bus.', 'sva');
to('she have → has', 'She have two brothers.', 'She has two brothers.', 'sva');
to('they wants → want', 'They wants to play.', 'They want to play.', 'sva');
to('I has → have', 'I has a car.', 'I have a car.', 'sva');
to('you is → are', 'You is my friend.', 'You are my friend.', 'sva');
to('we was → were', 'We was there yesterday.', 'We were there yesterday.', 'sva');
to('everyone have → has', 'Everyone have a phone now.', 'Everyone has a phone now.', 'sva');
to('nobody think → thinks', 'Nobody think about it.', 'Nobody thinks about it.', 'sva');
to('the students is → are', 'The students is happy.', 'The students are happy.', 'sva');
to('books develops → develop', 'Books develops the imagination.', 'Books develop the imagination.', 'sva');
to('the teacher give → gives', 'The teacher give us homework.', 'The teacher gives us homework.', 'sva');
same('let is base and past', 'The government let each state decide.', 'sva');
to('a past sentence: it go → went', 'One day Penny discovered it and it go to tell the queen.', 'One day Penny discovered it and it went to tell the queen.', 'sva');
same('let it go: "it" is an object', 'You should let it go.', 'sva');
same('the subjunctive after suggested', 'The board suggested that he go back to work.', 'sva');
same('if it were', 'If it were true, we would know.', 'sva');
same('read is both base and past', 'In the library he read voraciously.', 'sva');
same('a subject inside a phrase', 'The meta in these environments is often affected.', 'sva');
same('one of the students is', 'One of the students is late.', 'sva');
same('a gerund subject', 'Reading these chapters is a pleasure.', 'sva');
same('the people who live', 'The people who live here are kind.', 'sva');

/* verb forms */
to('can went → go', 'He can went home now.', 'He can go home now.', 'form');
to("didn't knew → know", "I didn't knew that.", "I didn't know that.", 'form');
to('did not went → go', 'I did not went there.', 'I did not go there.', 'form');
to('to went → go', 'I want to went home.', 'I want to go home.', 'form');
to('enjoy to play → playing', 'I enjoy to play football.', 'I enjoy playing football.', 'form');
to('want going → to go', 'I want going home.', 'I want to go home.', 'form');
to('by use → using', 'We saved money by use the bus.', 'We saved money by using the bus.', 'form');
to('interested in learn → learning', 'I am interested in learn English.', 'I am interested in learning English.', 'form');
to('look forward to see → seeing', 'I look forward to see you.', 'I look forward to seeing you.', 'form');
to('instead of be → being', 'Instead of be angry, he smiled.', 'Instead of being angry, he smiled.', 'form');
to('I am agree → I agree', 'I am agree with you.', 'I agree with you.', 'form');
same('is considered to be', 'The location is considered to be the same.', 'form');
same('learn swimming', 'Children can learn swimming early.', 'form');
same('for review: a noun', 'Her request for review was refused.', 'form');
same('a friend of mine', 'A friend of mine called.', 'form');
same('helped to lay', 'His ideas helped to lay the groundwork.', 'form');
same('to developed countries', 'They moved to developed countries.', 'form');

/* a missing am/is/are */
to('I going → I am going', 'I going to the shop now.', 'I am going to the shop now.', 'aux');
to('it very important → it is', 'It very important to study.', 'It is very important to study.', 'aux');
same('it good idea: another error, left alone', 'It good idea to go.', 'aux');
same('made it possible', 'They made it possible.', 'aux');

/* tense */
to('yesterday I go → went', 'Yesterday I go to the cinema.', 'Yesterday I went to the cinema.', 'tense');
to('last year we visit → visited', 'Last year we visit Paris.', 'Last year we visited Paris.', 'tense');
to('a past sentence: they kill → killed', "They did not have enough food, so they kill them.", "They did not have enough food, so they killed them.", 'tense');
same('every day: present', 'Every day I go to work.', 'tense');
same('I think it was', 'Yesterday I think it was fine.', 'tense');
same('inside speech', 'She said: "I know what you leave there" and ran.', 'tense');

/* number */
to('many student → students', 'There are many student here.', 'There are many students here.', 'num');
to('one of the first movie → movies', 'It is one of the first movie of its kind.', 'It is one of the first movies of its kind.', 'num');
to('a lot of place → places', 'There are a lot of place to visit.', 'There are a lot of places to visit.', 'num');
to('every students → student', 'Every students must come.', 'Every student must come.', 'num');
to('this things → these', 'I like this things.', 'I like these things.', 'num');
to('different kind of → kinds', 'There are different kind of sports.', 'There are different kinds of sports.', 'num');
same('a compound: team championships', 'They won several team championships.', 'num');
same('a few months', 'He left after a few months.', 'num');
same('most of the church', 'Most of the church was built later.', 'num');
same('accept that accounts', 'Most commentators accept that accounts may differ.', 'num');
same('these will', 'Eventually these will deposit on land.', 'num');
same('a name', 'He was a Formula One driver.', 'num');

/* articles and prepositions in fixed phrases */
to('in future → in the future', 'We will see in future.', 'We will see in the future.', 'art');
to('on other hand', 'On other hand, it is cheap.', 'On the other hand, it is cheap.', 'art');
to('is very beautiful place', 'It is very beautiful place.', 'It is a very beautiful place.', 'art');
same('had little effect', 'The attack had little effect.', 'art');
to('married with → to', 'She is married with a doctor.', 'She is married to a doctor.', 'prep');
to('in Monday → on', 'We met in Monday.', 'We met on Monday.', 'prep');
to('on 2019 → in', 'It opened on 2019.', 'It opened in 2019.', 'prep');
to('at the morning → in', 'We left at the morning.', 'We left in the morning.', 'prep');
to('discuss about', 'We discussed about the plan.', 'We discussed the plan.', 'prep');
to('go to home', 'I want to go to home.', 'I want to go home.', 'prep');
same('at Saturday Night (a name)', 'He was an editor at Saturday Night.', 'prep');
same('on the night of', 'On the night of 24 February, two bombs went off.', 'prep');
same('a career in television', 'She continued her career in television.', 'prep');
same('in day-to-day contact with', 'They are in day-to-day contact with the population.', 'prep');

/* words run together or split */
to('infront', 'He stood infront of me.', 'He stood in front of me.', 'orth');
to('every where → everywhere', 'You can stop every where.', 'You can stop everywhere.', 'orth');
to('now a days', 'Now a days it is common.', 'Nowadays it is common.', 'orth');
same('a lot: two words', 'We saw a lot of birds.', 'orth');

/* commas */
to('a fronted clause', 'If you want to buy a car you should save money.', 'If you want to buy a car, you should save money.', 'comma');
to('an opener', 'In my opinion the film was good.', 'In my opinion, the film was good.', 'comma');
to('first of all', 'First of all they are dirty.', 'First of all, they are dirty.', 'comma');
to('before but', 'My teachers are good at their job but I want more.', 'My teachers are good at their job, but I want more.', 'comma');
to('after "years ago"', 'Two years ago I moved here.', 'Two years ago, I moved here.', 'comma');
same('in addition to', 'In addition to the benefits, there are costs.', 'comma');
same('besides these items', 'Besides these items, the retiarius wore a belt.', 'comma');
same('then: no comma asked', 'Then I went to him.', 'comma');
same('however good', 'However good it is, we will not buy it.', 'comma');
same('as: left alone', 'As the war ended the troops went home.', 'comma');
same('an existing comma', 'If you want it, you can have it.', 'comma');

/* the whole check never overlaps and keeps order */
const E = L.check('Yesterday he go to school and they was happy, so they plays.');
ok('edits in order, none overlapping', E.every((e, i) => i === 0 || e.start >= E[i - 1].end), E);
ok('families listed', L.families.length === 9, L.families);

console.log(pass + ' of ' + (pass + fails.length) + ' pass');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }

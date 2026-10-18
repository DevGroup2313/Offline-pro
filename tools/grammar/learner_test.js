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

/* 7.43: correct scholarly prose, from published articles, left alone */
same('a list-final noun is not the subject', 'Engagement with literature, colleagues, and patients was repeatedly mentioned.', 'sva');
same('"what matters is"', 'What matters is not whether a clinician means it.', 'sva');
same('"what unites these levels is"', 'What unites these levels is a refusal to treat it lightly.', 'sva');
same('a gerund subject (British -ising)', 'Recognising these connections is a relevant field of work.', 'sva');
same('the object of a verb is not the subject', 'Her dependence on references to express her feelings does not fit.', 'sva');
same('a noun inside "of the"', 'The effect of the three sources is analysed collectively.', 'sva');
same('an adverb before the verb', 'It further contributes insights into moral plurality.', 'sva');
same('a question: "could she consider"', 'He reasons, could she consider taking Aubrey back?', 'sva');
same('a question: "would it take"', 'But how long would it take: a year, two years?', 'sva');
same('"someone like"', 'It seemed presumptuous for someone like Sheikh Hosni to aspire.', 'sva');
same('"between participants and scientists is"', 'The trust between participants and scientists is a dynamic factor.', 'sva');
same('"both patient and clinician"', 'The score is inaccessible to both patient and clinician alike.', 'num');
same('"many machine learning systems"', 'The character of many machine learning systems is opaque.', 'num');
same('"types of agency"', 'The above-mentioned types of agency might provide a direction.', 'num');
same('"This contrasts with"', 'This contrasts with the present study.', 'num');
same('"These address"', 'These address fundamental aspects of medical ethics.', 'num');
same('"nine face-to-face"', 'In this study, nine face-to-face interviews were held.', 'num');
same('"the suffering of patients"', 'The suffering of patients has remained at the margins.', 'prep');
same('"care for the majority"', 'Cancer care for the majority remains limited.', 'prep');
same('"made with a preference"', 'That choice is frequently made with an explicit preference.', 'prep');
same('"consist in the application"', 'They consist in the application of concepts.', 'prep');
same('"by its own standards"', 'It judged traditional systems by its own scientific standards.', 'prep');
same('"in the age of digital education"', 'This matters especially in the age of digital education.', 'prep');
same('"in there, somewhere"', 'You have to remember that, in there, somewhere, is a person.', 'prep');
same('"I argue" after a participle', 'Referring to the looping effect as discussed above, I argue that it matters.', 'tense');
same('present perfect, then present', 'They have entered a strange place, and they expect kindness.', 'tense');
same('"have been described", then present', 'These cells have been described as advantageous because they carry fewer concerns.', 'tense');
same('a name, not a verb: "according to Said"', 'According to Said, in late style, the artist is free.', 'form');
same('passive "recommended to preserve"', 'Lotteries are sometimes recommended to preserve equality.', 'form');
same('the noun "will"', 'Beyond the intellect, the will is the faculty of choice.', 'form');
same('"a living will refers"', 'In law, a living will refers to a document.', 'form');
same('"practice to recognize"', 'They accumulate enough experience in practice to recognize patterns.', 'form');
same('"in future encounters"', 'Patients come to expect it in future encounters.', 'art');
same('"the vast majority of"', 'The vast majority of participants agreed.', 'art');
same('"in end-of-life care"', 'It matters particularly in end-of-life care.', 'art');
same('"her self-perception"', 'It intertwines her self-perception with her past.', 'orth');
same('"any one interpretation"', 'This does not mean that any one interpretation is as good as the next.', 'orth');
same('a quotation holds the past marker', 'Grant observes her resilience when he recalls that "over a year ago, Grant had started".', 'tense');
same('"both sufficient exposure to real problems and"', 'It ensures both sufficient exposure to real-world problems and enough time.', 'num');
same('"one of justification"', 'The crucial difference is one of justification.', 'num');
same('"per resources expended"', 'It maximises outcomes per resources expended.', 'num');
same('a non-breaking hyphen compound', 'On this view, two architecture\u2011level commitments do the work.', 'num');
same('"decision-makers" inside "of"', 'The existence of such rules and institutional decision-makers reflects a reality.', 'sva');
same('"range from 18 weeks"', 'The targets usually range from 18 weeks for routine procedures.', 'prep');
same('"a lot of moral satisfaction"', 'People derive a lot of moral satisfaction from it.', 'num');
same('"five evaluation criteria"', 'It was compared across five evaluation criteria.', 'num');
same('"These alternative medical practices"', 'These alternative medical practices were rooted in the region.', 'num');
same('"an altogether different kind of"', 'It produced an altogether different kind of victimhood.', 'num');
same('"lest she fall"', 'She was told to control her conduct, lest she fall foul of hysterics.', 'tense');
same('"scholars researching this topic have"', 'Although scholars researching this topic have different views, they agree.', 'sva');
same('"if every victim were to"', 'If every victim were to erase their memories, safety would suffer.', 'sva');
same('"surrogate decision-makers was"', 'Pressure from families or surrogate decision-makers was a driving force.', 'sva');
same('"the dying and their families is"', 'The quality of care received by the dying and their families is poorly addressed.', 'sva');
same('"answers to my questions"', 'Can you deliver comprehensive answers to my questions?', 'prep');
same('"the answer to this question"', 'The answer to this question shapes clinical practice.', 'prep');
same('"what is known about"', 'Ethics does not emerge from what is known about the Other.', 'prep');
same('"a majority of"', 'It was a space shared with a majority of able-bodied people.', 'art');
same('"one of the gang"', 'Ramadan, one of the gang, betrays a playful fixation.', 'num');
same('"intellect and will allows"', 'This integration of intellect and will allows human beings to discern the good.', 'form');
same('"real world value"', 'Hermeneutics have real world value for physicians.', 'art');
same('"until both crash down"', 'The music grows louder until both crash down.', 'num');
/* and the learners' errors near them are still caught */
to('one of my friend → friends', 'One of my friend called.', 'One of my friends called.', 'num');
to('a lot of student → students', 'There were a lot of student in the hall.', 'There were a lot of students in the hall.', 'num');
to('I answered to the question', 'I answered to the question quickly.', 'I answered the question quickly.', 'prep');
to('a numbers of → number', 'He lists a numbers of illnesses.', 'He lists a number of illnesses.', 'num');
to('both + a singular noun, no "and"', 'I like both book.', 'I like both books.', 'num');
to('suffering of → from (a verb)', 'He is suffering of a cold.', 'He is suffering from a cold.', 'prep');
to('in the age of 10', 'He left school in the age of 10.', 'He left school at the age of 10.', 'prep');
to('in future, alone', 'I will do better in future.', 'I will do better in the future.', 'art');

/* the whole check never overlaps and keeps order */
const E = L.check('Yesterday he go to school and they was happy, so they plays.');
ok('edits in order, none overlapping', E.every((e, i) => i === 0 || e.start >= E[i - 1].end), E);
ok('families listed', L.families.length === 9, L.families);

console.log(pass + ' of ' + (pass + fails.length) + ' pass');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }

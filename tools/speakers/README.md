# Finding the speakers, offline: how it was chosen and measured

Scriba's "Find the speakers" runs on the device, in a worker, with two small
open models fetched once (about 33 MB) through the speech library the app
already carries (Transformers.js 3.8.1):

- pyannote segmentation 3.0, ONNX (`onnx-community/pyannote-segmentation-3.0`,
  MIT licence): who speaks when, inside 10 second windows, up to three voices
  at once;
- WeSpeaker ResNet34 (`onnx-community/wespeaker-voxceleb-resnet34-LM`,
  CC BY 4.0): a voice print of each voice in each window, taken from the
  moments it speaks alone.

The voice prints are grouped (closest groups first, cosine distance, centroid
linkage, stop at 0.3). A group with fewer than max(5, 2% of all voice prints)
members is not taken to be a person and joins the nearest real group. Each
moment then takes as many speakers as the windows hear, strongest groups
first. A paragraph takes the speaker heard most in it. When the speakers are
found before transcribing, Scriba also cuts paragraphs where the speaker
changes. The code is `diar.mjs`; the app's worker in `src/rooms/scriba.html`
(`scribaSpkWorker`) runs the same steps.

## Data

The AMI meeting corpus, single distant microphone (Array1, channel 1),
CC BY 4.0, from `huggingface.co/datasets/diarizers-community/ami`: four
people round a table, one microphone in the room, which is close to a tablet
on a table. `prepare_ami.py` fetches it.

- Settings were chosen on six meetings from the validation shard
  (`results_val_grid.jsonl`, `results_val_excerpts_grid.jsonl`).
- They were then fixed and reported on six other meetings from the test shard,
  never used for choosing (`results_test_full.jsonl`,
  `results_test_excerpts.jsonl`).

## Measures

- DER, the diarization error rate: the share of speaking time that is missed,
  falsely detected, or given to the wrong person, with no forgiveness collar
  and overlapping speech included. Lower is better.
- Paragraph accuracy: Scriba's own paragraphs (cut at pauses, at most 24 s);
  the share of one-person speech time whose paragraph names the right person.
- Paragraph accuracy when cut at turns: the same, when paragraphs are also cut
  where the found speaker changes (what "Find the speakers" before
  "Transcribe" gives).

## Results on the six test meetings (183.7 minutes)

| Meeting | Minutes | Speakers | Found | DER % | Missed | False | Wrong person | Paragraphs right % | Cut at turns % |
|---|---|---|---|---|---|---|---|---|---|
| EN2002b | 29.8 | 4 | 4 | 26.3 | 15.1 | 4.3 | 6.9 | 73.6 | 91.3 |
| TS3003a | 25.1 | 4 | 2 | 24.0 | 14.5 | 3.5 | 6.0 | 90.3 | 92.5 |
| ES2004c | 38.9 | 4 | 4 | 14.8 | 7.1 | 4.7 | 3.0 | 84.7 | 96.5 |
| ES2004b | 39.1 | 4 | 4 | 16.0 | 8.7 | 4.4 | 2.8 | 85.4 | 96.0 |
| TS3003b | 36.8 | 4 | 4 | 14.6 | 6.2 | 5.6 | 2.9 | 90.1 | 97.0 |
| IS1009a | 14.0 | 4 | 4 | 22.8 | 8.5 | 6.9 | 7.4 | 81.5 | 93.1 |
| All six (time-weighted) | 183.7 | | | 18.7 | 9.7 | 4.8 | 4.3 | 84.7 | 94.8 |

Excerpts of the same test meetings, starting five minutes in:

| Length | Excerpts | DER % | Wrong person | Paragraphs right % | Cut at turns % | Speaker count right |
|---|---|---|---|---|---|---|
| 3 min | 6 | 18.5 | 5.6 | 88.7 | 94.4 | 2 of 6 |
| 5 min | 6 | 20.0 | 6.6 | 84.7 | 93.3 | 2 of 6 |
| 10 min | 5 | 18.2 | 4.1 | 87.4 | 94.9 | 3 of 5 |

The number of speakers is the weak point on short recordings. A person who
says a few words in a three minute excerpt is usually folded into another
voice. Given the number of speakers ("How many?"), the count was right in 15
of 17 test excerpts, but more speech went to the wrong person (DER 26.5%,
wrong person 12.9%, against about 19% without it). On whole meetings the
count changed nothing (DER 18.8%). The app offers the choice and says so.

## Limits

- Measured on English meetings recorded in rooms, with four speakers. Other
  languages, phone calls, lectures with one main speaker, or noisy rooms may do
  better or worse; this was not measured.
- Speed was measured on this build machine (4 cores, Node.js and Chromium), not
  on the Fire tablet. In Chromium, a 3 minute recording took 82 seconds
  including the first download of the models. A tablet will be slower.
- These numbers are for this method; they are not a comparison with any
  published system, whose scoring rules differ.

import { Component, OnInit } from '@angular/core';
import { NavController } from 'ionic-angular';
import { SpeechRecognition } from '@ionic-native/speech-recognition';

@Component({
  selector: 'pitch',
  templateUrl: 'pitch.html'
})
export class PitchPage implements OnInit {

	audioContext: AudioContext;
	isPlaying: boolean = false;
	sourceNode: any = null;
	analyser: any = null;
	theBuffer: any = null;
	DEBUGCANVAS: any = null;
	mediaStreamSource: any = null;
	canvasElem: any;
	waveCanvas: any;
	pitchElem: any;
	noteElem: any;
	detuneElem: any;
	detuneAmount: any;
	rafID: any = null;
	tracks: any = null;
	buflen: number = 1024;
	buf: Float32Array;
	MIN_SAMPLES: number = 0;  // this will be initialized when audioContext is created.
	GOOD_ENOUGH_CORRELATION: number = 0.9; // this is the "bar" for how close a correlation needs to be
	isLiveInput: boolean = true;

	noteStrings: Array<String> = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

	pitchValue: any;
	noteValue: any;
	detuneValue: any;

    constructor(
    	public navCtrl: NavController,
    	public speech: SpeechRecognition
    	) {

    }

    ngOnInit() {

  	    this.audioContext = new AudioContext();
  	    this.buf = new Float32Array( this.buflen );

		this.detuneElem = document.getElementById( "detune" );
		this.detuneAmount = document.getElementById( "detune_amt" );

		navigator.mediaDevices.getUserMedia({
			    audio: true,
			    video: false
			})
        	.then((stream) => {


        		this.mediaStreamSource = this.audioContext.createMediaStreamSource(stream);

			    // Connect it to the destination.

			    this.analyser = this.audioContext.createAnalyser();
			    this.analyser.fftSize = 2048;
			    this.mediaStreamSource.connect( this.analyser );

			    this.updatePitch();
        	})
        	.catch(this.error);
    }

    async hasPermission():Promise<boolean> {
	    try {
	      const permission = await this.speech.hasPermission();
	      console.log(permission);

	      return permission;
	    } catch(e) {
	      console.log(e);
	    }
	  }

	  async getPermission():Promise<void> {
	    try {
	      this.speech.requestPermission();
	    } catch(e) {
	      console.log(e);
	    }
	  }

    error(e) {
    	console.log(e);
	    alert('Stream generation failed.');
	}

	noteFromPitch( frequency ) {
		let noteNum = 12 * (Math.log( frequency / 440 )/Math.log(2) );
		return Math.round( noteNum ) + 69;
	}

	frequencyFromNoteNumber=( note ) => {
		return 440 * Math.pow(2,(note-69)/12);
	}

	centsOffFromPitch=( frequency, note ) => {
		return Math.floor( 1200 * Math.log( frequency / this.frequencyFromNoteNumber( note ))/Math.log(2) );
	}

	autoCorrelate=( buf, sampleRate ) => {
		let SIZE = buf.length;
		let MAX_SAMPLES = Math.floor(SIZE/2);
		let best_offset = -1;
		let best_correlation = 0;
		let rms = 0;
		let foundGoodCorrelation = false;
		let correlations = new Array(MAX_SAMPLES);

		for (let i=0;i<SIZE;i++) {
			let val = buf[i];
			rms += val*val;
		}
		rms = Math.sqrt(rms/SIZE);
		if (rms<0.01) // not enough signal
			return -1;

		let lastCorrelation=1;
		for (let offset = this.MIN_SAMPLES; offset < MAX_SAMPLES; offset++) {
			let correlation = 0;

			for (let i=0; i<MAX_SAMPLES; i++) {
				correlation += Math.abs((buf[i])-(buf[i+offset]));
			}
			correlation = 1 - (correlation/MAX_SAMPLES);
			correlations[offset] = correlation; // store it, for the tweaking we need to do below.
			if ((correlation>this.GOOD_ENOUGH_CORRELATION) && (correlation > lastCorrelation)) {
				foundGoodCorrelation = true;
				if (correlation > best_correlation) {
					best_correlation = correlation;
					best_offset = offset;
				}
			} else if (foundGoodCorrelation) {
				// short-circuit - we found a good correlation, then a bad one, so we'd just be seeing copies from here.
				// Now we need to tweak the offset - by interpolating between the values to the left and right of the
				// best offset, and shifting it a bit.  This is complex, and HACKY in this code (happy to take PRs!) -
				// we need to do a curve fit on correlations[] around best_offset in order to better determine precise
				// (anti-aliased) offset.

				// we know best_offset >=1, 
				// since foundGoodCorrelation cannot go to true until the second pass (offset=1), and 
				// we can't drop into this clause until the following pass (else if).
				let shift = (correlations[best_offset+1] - correlations[best_offset-1])/correlations[best_offset];  
				return sampleRate/(best_offset+(8*shift));
			}
			lastCorrelation = correlation;
		}
		if (best_correlation > 0.01) {
			// console.log("f = " + sampleRate/best_offset + "Hz (rms: " + rms + " confidence: " + best_correlation + ")")
			return sampleRate/best_offset;
		}
		return -1;
	//	let best_frequency = sampleRate/best_offset;
	}

	updatePitch=( time = null ) => {
		let cycles = new Array;
		this.analyser.getFloatTimeDomainData( this.buf );
		console.log('buf', this.buf);
		let ac = this.autoCorrelate( this.buf, this.audioContext.sampleRate );

		console.log('ac', ac);

	 	if (ac == -1) {
			this.detuneElem.className = "";
			this.detuneAmount.innerText = "--";
			this.pitchValue = "--";
			this.noteValue = "--";
	 	} else {
		 	let pitch = ac;
		 	this.pitchValue = Math.round( pitch ) ;

		 	let note =  this.noteFromPitch( pitch );
			this.noteValue = this.noteStrings[note%12];


			let detune = this.centsOffFromPitch( pitch, note );

			if (detune == 0 ) {
				this.detuneElem.className = "";
				this.detuneValue = "--";
			} else {
				if (detune < 0)
					this.detuneElem.className = "flat";
				else
					this.detuneElem.className = "sharp";
				this.detuneValue = Math.abs( detune );
			}
		}

		if (!window.requestAnimationFrame)
			window.requestAnimationFrame = window.webkitRequestAnimationFrame;
		this.rafID = window.requestAnimationFrame( () => { this.updatePitch(); } );
	}

}

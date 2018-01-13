import { Component, OnInit } from '@angular/core';
import { NavController } from 'ionic-angular';

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
	detectorElem: any; 
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

    constructor(public navCtrl: NavController) {

    }

    ngOnInit() {

  	    this.audioContext = new AudioContext();
  	    this.buf = new Float32Array( this.buflen );

  	    let  MAX_SIZE = Math.max(4,Math.floor(this.audioContext.sampleRate/5000));	// corresponds to a 5kHz signal
		let request = new XMLHttpRequest();

		this.detectorElem = document.getElementById( "detector" );
		this.canvasElem = document.getElementById( "output" );
		this.DEBUGCANVAS = document.getElementById( "waveform" );
		if (this.DEBUGCANVAS) {
			this.waveCanvas = this.DEBUGCANVAS.getContext("2d");
			this.waveCanvas.strokeStyle = "black";
			this.waveCanvas.lineWidth = 1;
		}
		this.pitchElem = document.getElementById( "pitch" );
		this.noteElem = document.getElementById( "note" );
		this.detuneElem = document.getElementById( "detune" );
		this.detuneAmount = document.getElementById( "detune_amt" );

		this.detectorElem.ondragenter = function() { 
			this.classList.add("droptarget"); 
			return false; };
		this.detectorElem.ondragleave = function() { this.classList.remove("droptarget"); return false; };
		this.detectorElem.ondrop = function (e) {
	  		this.classList.remove("droptarget");
	  		e.preventDefault();
			this.theBuffer = null;

		  	let reader = new FileReader();
		  	reader.onload = (event:any) => {
		  		this.audioContext.decodeAudioData( event.target.result, function(buffer) {
		    		this.theBuffer = buffer;
		  		}, function(){alert("error loading!");} ); 
		  	};
		  	reader.onerror = function (event) {
		  		alert("Error: " + reader.error );
			};
		  	reader.readAsArrayBuffer(e.dataTransfer.files[0]);
		  	return false;
		};
		
		this.toggleLiveInput();
    }

    error(e) {
    	console.log(e);
	    alert('Stream generation failed.');
	}

	getUserMedia(dictionary, callback) {
	    try {
	    	console.log('here1');
	        navigator.mediaDevices.getUserMedia(dictionary)
	        	.then(callback)
	        	.catch(this.error);

	    	console.log('here2');
	    } catch (e) {

	    	console.log('here3');
	        alert('getUserMedia threw exception :' + e);
	    }
	}

	gotStream=(stream) => {
	    // Create an AudioNode from the stream.

	    	console.log('here4');
	    this.mediaStreamSource = this.audioContext.createMediaStreamSource(stream);
	    	console.log('here5');

	    // Connect it to the destination.

	    	console.log('here6');
	    this.analyser = this.audioContext.createAnalyser();
	    this.analyser.fftSize = 2048;
	    this.mediaStreamSource.connect( this.analyser );

	    	console.log('here7');
	    this.updatePitch();

	    	console.log('here8');
	}

	toggleLiveInput() {
	    if (this.isPlaying) {
	        //stop playing and return
	        this.sourceNode.stop( 0 );
	        this.sourceNode = null;
	        this.analyser = null;
	        this.isPlaying = false;
			if (!window.cancelAnimationFrame)
				window.cancelAnimationFrame = window.webkitCancelAnimationFrame;
	        window.cancelAnimationFrame( this.rafID );
	    }
	    this.getUserMedia(
	    	{
			    audio: true,
			    video: false
			}, this.gotStream);
	}

	noteFromPitch( frequency ) {
		let noteNum = 12 * (Math.log( frequency / 440 )/Math.log(2) );
		return Math.round( noteNum ) + 69;
	}

	frequencyFromNoteNumber( note ) {
		return 440 * Math.pow(2,(note-69)/12);
	}

	centsOffFromPitch( frequency, note ) {
		return Math.floor( 1200 * Math.log( frequency / this.frequencyFromNoteNumber( note ))/Math.log(2) );
	}

	autoCorrelate( buf, sampleRate ) {
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
		let ac = this.autoCorrelate( this.buf, this.audioContext.sampleRate );
		// TODO: Paint confidence meter on this.canvasElem here.

		if (this.DEBUGCANVAS) {  // This draws the current waveform, useful for debugging
			this.waveCanvas.clearRect(0,0,512,256);
			this.waveCanvas.strokeStyle = "red";
			this.waveCanvas.beginPath();
			this.waveCanvas.moveTo(0,0);
			this.waveCanvas.lineTo(0,256);
			this.waveCanvas.moveTo(128,0);
			this.waveCanvas.lineTo(128,256);
			this.waveCanvas.moveTo(256,0);
			this.waveCanvas.lineTo(256,256);
			this.waveCanvas.moveTo(384,0);
			this.waveCanvas.lineTo(384,256);
			this.waveCanvas.moveTo(512,0);
			this.waveCanvas.lineTo(512,256);
			this.waveCanvas.stroke();
			this.waveCanvas.strokeStyle = "black";
			this.waveCanvas.beginPath();
			this.waveCanvas.moveTo(0,this.buf[0]);
			for (let i=1;i<512;i++) {
				this.waveCanvas.lineTo(i,128+(this.buf[i]*128));
			}
			this.waveCanvas.stroke();
		}

	 	if (ac == -1) {
	 		this.detectorElem.className = "vague";
		 	this.pitchElem.innerText = "--";
			this.noteElem.innerText = "-";
			this.detuneElem.className = "";
			this.detuneAmount.innerText = "--";
	 	} else {
		 	this.detectorElem.className = "confident";
		 	let pitch = ac;
		 	this.pitchElem.innerText = Math.round( pitch ) ;
		 	let note =  this.noteFromPitch( pitch );
			this.noteElem.innerHTML = this.noteStrings[note%12];
			let detune = this.centsOffFromPitch( pitch, note );
			if (detune == 0 ) {
				this.detuneElem.className = "";
				this.detuneAmount.innerHTML = "--";
			} else {
				if (detune < 0)
					this.detuneElem.className = "flat";
				else
					this.detuneElem.className = "sharp";
				this.detuneAmount.innerHTML = Math.abs( detune );
			}
		}

		if (!window.requestAnimationFrame)
			window.requestAnimationFrame = window.webkitRequestAnimationFrame;
		this.rafID = window.requestAnimationFrame( this.updatePitch );
	}

}

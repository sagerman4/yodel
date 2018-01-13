import { Component } from '@angular/core';
import { NavController } from 'ionic-angular';

import { PitchPage } from '../pitch/pitch';

@Component({
  selector: 'page-home',
  templateUrl: 'home.html'
})
export class HomePage {

  	constructor(
  		public navCtrl: NavController) {
  }

  matchPitch() {
  	console.log('here');
  	this.navCtrl.push(PitchPage);
  }

}

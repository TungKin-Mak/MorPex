/**
 * ControlPlane — AI System Controller
 * 类似 Kubernetes Controller，系统所有行为经过此层
 */
import { GoalController } from './GoalController.js';
import { PolicyController } from './PolicyController.js';
import { ResourceController } from './ResourceController.js';
import { AgentController } from './AgentController.js';
import { EvolutionController } from './EvolutionController.js';

export class ControlPlane {
  readonly goal = new GoalController();
  readonly policy = new PolicyController();
  readonly resource = new ResourceController();
  readonly agent = new AgentController();
  readonly evolution = new EvolutionController();
}

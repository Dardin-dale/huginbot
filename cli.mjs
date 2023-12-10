import inquirer from 'inquirer';
import { CloudFormation } from '@aws-sdk/client-cloudformation';
const cloudformation = new CloudFormation();


function displayIntro() {
  const asciiArt = `
                 **#%                       
               #@@@*%@@%                    
            -@@@@@@@@@@@##%%              %%
                 #@@@@%*@*%%#%###%##% %#    
                 +*%%@*@%###@%%%#%###*#+    
                  #*@%%@@@@@@@%@@@@@%%%%    
                   %@%%@@%@@@@@@%%%      %% 
                     =%@@@@@@@@             
                        @@ @@@              
                        %@ @@@              
                       #@  %@               
                       +   +                
                   *#%+@#@#%%               
                   @# % @ % #               
                      @   @ %                                              
                   _______ _________ _        ______   _______ _________
|\     /||\     /|(  ____ \\__   __/( (    /|(  ___ \ (  ___  )\__   __/
| )   ( || )   ( || (    \/   ) (   |  \  ( || (   ) )| (   ) |   ) (   
| (___) || |   | || |         | |   |   \ | || (__/ / | |   | |   | |   
|  ___  || |   | || | ____    | |   | (\ \) ||  __ (  | |   | |   | |   
| (   ) || |   | || | \_  )   | |   | | \   || (  \ \ | |   | |   | |   
| )   ( || (___) || (___) |___) (___| )  \  || )___) )| (___) |   | |   
|/     \|(_______)(_______)\_______/|/    )_)|/ \___/ (_______)   )_(   
  `;
  console.log(asciiArt);
}

function isStackDeployed(stackName, callback) {
  cloudformation.describeStacks({ StackName: stackName }, (err, data) => {
    if (err) callback(false);
    else callback(true);
  });
}

function deployInfrastructure() {
  const stackName = 'ValheimStack';
  
  isStackDeployed(stackName, (deployed) => {
    if (deployed) {
      console.log(`Stack ${stackName} is already deployed.`);
    } else {
        // Deploy the CDK stack
        execSync('npm run cdk deploy', { stdio: 'inherit' });
    }
  });
}

function createWorld() {
    // Function to create a new world
}

function deleteWorld() {
    // Function to delete a world
}

function mainMenu() {
  displayIntro();
  inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What do you want to do?',
      choices: ['Deploy Infrastructure', 'Create World', 'Delete World', 'Exit'],
    }
  ]).then((answers) => {
    switch (answers.action) {
      case 'Deploy Infrastructure':
        deployInfrastructure();
        break;
      case 'Exit':
        process.exit();
    }
  });
}

mainMenu();

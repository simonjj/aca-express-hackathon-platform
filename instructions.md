# Scenario
You are tasked with developing a hackathon compute platform based on Azure Container Apps Express. This platform should enable any company to run a AI hackathon accessible by a broad set of employees from finance, HR, operaitons and of course engineering. 
All applications/static sites/apis developed during the hackathon should be deployed into a single ACA Express environment. All of this should be accessible without the need for any hackathon participant to require access credentials for Azure itself. The hackathon participants will utilize AI agents to do their deployments which will utilize a SKILL to learn aboutthe deployment to the platform.
After the deployment participants may make additional changes to the application and each iteration should be kept as an image snapshot and made available to particpants as a rollback if needed. The platform should have a GUI which without login allows participants to learn about the hackathon, stages the SKILL, then upon login will provide them with a list of their applications, their status, a link to the applications served web-UI or API URL. Upon clicking on the application details the snapshots/versions of the application can be seen and selected if needed. Deployments will be done via an API that allows the specification of:
    - a name for the application
    - the deployment method (pre-defined image or conainer)
    - the size of the replica (1cpu/2ram, 2cpu/4ram, 4cpu/8ram)
The platform itself should be deployable via the azd CLI and should provide inputs such region, resource group, default replica size as an option during deployment.


# Details
- Authentication should ultimately be provided via EntraID but for now (due to our Tenant limitation) we will use Keycloak. Use the following repo to see how: https://github.com/simonjj/aca-easyauth-rule-based-routing. Ignore the rule-based routing details.
- The hackathon platform UI and API should themselves be a Express application. Which I _think_ could use MI to provision other applications on behalf of users. Please confirm this method to be 1. workable and 2. easy
- Provide the SKILL for agents to use the platform to deploy as part of this project.
- Keep a clean sub-directory structure for all the components.
- Allow users to provide instructions on the pre-login hackathon homepage via markdown but in-line with the theme of the platform.
- As a theme use the following a guide https://cdn3.vectorstock.com/i/1000x1000/88/72/control-panel-ui-user-interface-hud-set-vector-10598872.jpg
- The platform should be prepared with all the best-practice things (README, architecture, troubleshooting, quickstart, high-level description, keycloak switch to entraID switch) and is ready to be pushed to simonjj/aca-express-hackathon-platform
- ACA Express usage skill is here: "C:\Users\simonjakesch\OneDrive - Microsoft\copilot\SKILLS\express-and-sandbox-usage"


# Evaluation of Success
A template exists which has been deployed successfully to Azure Container Apps Express which provides a hackathon platform for users to deploy their AI developed applications.


